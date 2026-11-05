use crate::ai::{AiProviderProfile, ConnectionProfile, FallbackPolicy, StreamLease, TaskAttempt};
use crate::storage::{next_id, now_string};
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    RateLimit,
    Quota,
    Outage,
    Authentication,
    Billing,
    Safety,
    InvalidInput,
    UnknownResult,
}
impl Failure {
    pub fn classify(error: &str) -> Self {
        if error.starts_with("[RATE_LIMIT ") {
            Self::RateLimit
        } else if error.starts_with("[QUOTA]") {
            Self::Quota
        } else if error.starts_with("[OUTAGE]") {
            Self::Outage
        } else if error.starts_with("[AUTH]") {
            Self::Authentication
        } else if error.starts_with("[BILLING]") {
            Self::Billing
        } else if error.starts_with("[SAFETY]") {
            Self::Safety
        } else if error.starts_with("[VALIDATION]") {
            Self::InvalidInput
        } else {
            Self::UnknownResult
        }
    }
    pub fn cooldown_ms(self, error: &str) -> u64 {
        match self {
            Self::RateLimit => error
                .split("retry_after_ms=")
                .nth(1)
                .and_then(|s| s.split(']').next())
                .and_then(|s| s.parse().ok())
                .unwrap_or(60_000)
                .clamp(1000, 86_400_000),
            Self::Quota => 3_600_000,
            Self::Outage => 10_000,
            _ => 0,
        }
    }
    fn permits_fallback(self) -> bool {
        matches!(self, Self::RateLimit | Self::Quota | Self::Outage)
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone)]
pub struct Candidate {
    pub connection: ConnectionProfile,
    pub transport: AiProviderProfile,
    pub blocked_until: u64,
}

pub fn eligible(primary: &Candidate, candidate: &Candidate, policy: &FallbackPolicy) -> bool {
    let p = &primary.connection;
    let c = &candidate.connection;
    policy.enabled
        && policy.routing_owner == "forgekit"
        && p.connection_mode == "direct"
        && c.connection_mode == "direct"
        && c.enabled
        && c.access_state == "ready"
        && c.fallback_eligible == "supported"
        && c.id != p.id
        && policy.ordered_profile_ids.contains(&c.id)
        && policy.allowed_provider_ids.contains(&c.provider_id)
        && (policy.allow_cross_provider || c.provider_id == p.provider_id)
        && (policy.allow_model_change || c.model == p.model)
        && !p.quota_bucket_refs.is_empty()
        && !c.quota_bucket_refs.is_empty()
        && !p
            .quota_bucket_refs
            .iter()
            .any(|bucket| c.quota_bucket_refs.contains(bucket))
        && candidate.blocked_until <= now_ms()
}

#[derive(Default)]
struct Active {
    profiles: HashSet<String>,
    buckets: HashSet<String>,
}
static ACTIVE: LazyLock<Mutex<Active>> = LazyLock::new(|| Mutex::new(Active::default()));
pub fn is_profile_active(id: &str) -> bool {
    ACTIVE
        .lock()
        .map(|active| active.profiles.contains(id))
        .unwrap_or(true)
}
pub(crate) struct CapacityLease {
    id: String,
    buckets: Vec<String>,
}
impl CapacityLease {
    pub(crate) fn acquire(profile: &ConnectionProfile) -> Result<Self, String> {
        let mut active = ACTIVE
            .lock()
            .map_err(|_| "Kapasitas koneksi tidak tersedia.")?;
        if active.profiles.len() >= 3
            || active.profiles.contains(&profile.id)
            || profile
                .quota_bucket_refs
                .iter()
                .any(|bucket| active.buckets.contains(bucket))
        {
            return Err("Kapasitas koneksi sedang dipakai tugas lain. Pekerjaan tersimpan; coba setelah tugas selesai.".into());
        }
        active.profiles.insert(profile.id.clone());
        active.buckets.extend(profile.quota_bucket_refs.clone());
        Ok(Self {
            id: profile.id.clone(),
            buckets: profile.quota_bucket_refs.clone(),
        })
    }
}
impl Drop for CapacityLease {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            active.profiles.remove(&self.id);
            for bucket in &self.buckets {
                active.buckets.remove(bucket);
            }
        }
    }
}

pub fn run<T>(
    task: &str,
    candidates: &[Candidate],
    policy: &FallbackPolicy,
    lease: &StreamLease,
    mut journal: impl FnMut(&TaskAttempt, u64) -> Result<(), String>,
    mut operation: impl FnMut(&AiProviderProfile, u64) -> Result<T, String>,
) -> Result<T, String> {
    let primary = candidates.first().ok_or("Akun pilihan tidak ditemukan.")?;
    if !primary.connection.enabled {
        return Err("Akun pilihan dinonaktifkan.".into());
    }
    let started = Instant::now();
    let mut used = HashSet::new();
    let mut blocked_buckets = HashSet::new();
    let mut attempts = 0;
    let mut last_error =
        "Belum ada akun cadangan yang dapat menjalankan tugas ini. Pekerjaanmu tersimpan."
            .to_string();
    for (index, candidate) in candidates.iter().enumerate() {
        if lease.is_cancelled() {
            return Err("Permintaan dibatalkan.".into());
        }
        if index > 0 && !eligible(primary, candidate, policy) {
            continue;
        }
        if candidate.blocked_until > now_ms()
            || candidate
                .connection
                .quota_bucket_refs
                .iter()
                .any(|b| blocked_buckets.contains(b))
        {
            continue;
        }
        if !used.insert(&candidate.connection.id) {
            continue;
        }
        if attempts >= policy.max_attempts.clamp(1, 5) {
            break;
        }
        let remaining = (policy.max_elapsed_ms.clamp(1000, 1_200_000) as u64)
            .saturating_sub(started.elapsed().as_millis() as u64);
        if remaining < 1000 {
            break;
        }
        let _capacity = match CapacityLease::acquire(&candidate.connection) {
            Ok(capacity) => capacity,
            Err(error) if policy.enabled => { last_error = error; continue; }
            Err(error) => return Err(error),
        };
        attempts += 1;
        let mut attempt = TaskAttempt {
            id: next_id("attempt"),
            task_id: task.into(),
            profile_id: candidate.connection.id.clone(),
            provider_id: candidate.connection.provider_id.clone(),
            model_id: candidate.connection.model.clone(),
            checkpoint_id: format!("{task}:before-inference"),
            status: "started".into(),
            started_at: now_string(),
            completed_at: None,
            provider_request_id: None,
            provider_job_id: None,
            error: None,
        };
        journal(&attempt, 0)?;
        if lease.is_cancelled() {
            attempt.status = "cancelled".into();
            attempt.completed_at = Some(now_string());
            journal(&attempt, 0)?;
            return Err("Permintaan dibatalkan.".into());
        }
        let result = operation(&candidate.transport, remaining / 1000);
        let result = if lease.is_cancelled() {
            Err("Permintaan dibatalkan.".into())
        } else {
            result
        };
        attempt.completed_at = Some(now_string());
        let cooldown = match &result {
            Ok(_) => {
                attempt.status = "succeeded".into();
                0
            }
            Err(error) => {
                let failure = Failure::classify(error);
                attempt.status = if lease.is_cancelled() {
                    "cancelled"
                } else if failure == Failure::RateLimit {
                    "rate_limited"
                } else {
                    "failed"
                }
                .into();
                attempt.error = Some(error.clone());
                failure.cooldown_ms(error)
            }
        };
        journal(&attempt, cooldown)?;
        match result {
            Ok(value) => return Ok(value),
            Err(error) => {
                let failure = Failure::classify(&error);
                if !failure.permits_fallback() || lease.is_cancelled() {
                    return Err(error);
                }
                blocked_buckets.extend(candidate.connection.quota_bucket_refs.iter().cloned());
                last_error = error;
                if !policy.enabled
                    || policy.routing_owner == "router"
                    || candidate.connection.connection_mode == "router"
                {
                    break;
                }
            }
        }
    }
    Err(format!("{last_error} Tidak ada akun tersedia pada provider dan model pilihan. Pilih akun/provider lain atau tunggu kuota pulih. Pekerjaan tersimpan."))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn candidate(id: &str) -> Candidate {
        let conn: ConnectionProfile = serde_json::from_value(serde_json::json!({
            "id":id,"providerId":"openai","connectionMode":"direct","credentialOwner":"forgekit",
            "authMethod":"api_key","label":id,"credentialRef":id,"accessState":"ready","enabled":true,
            "fallbackEligible":"supported","priority":0,"quotaBucketRefs":[id],"baseUrl":"https://api.openai.com/v1",
            "model":"fixture","isDefault":false,"createdAt":"1","updatedAt":"1"
        })).unwrap();
        Candidate {
            transport: crate::connections::legacy(&conn, None).unwrap(),
            connection: conn,
            blocked_until: 0,
        }
    }
    fn policy() -> FallbackPolicy {
        FallbackPolicy {
            id: "default-fallback-policy".into(),
            enabled: true,
            ordered_profile_ids: vec!["b".into(), "c".into()],
            allowed_provider_ids: vec!["openai".into()],
            allow_cross_provider: false,
            allow_model_change: false,
            routing_owner: "forgekit".into(),
            max_attempts: 3,
            max_elapsed_ms: 60000,
            budget_policy_id: None,
            data_policy_id: None,
        }
    }
    #[test]
    fn fallback_is_bounded_scoped_and_cancelled() {
        let a = candidate("a");
        let mut b = candidate("b");
        let p = policy();
        assert!(eligible(&a, &b, &p));
        b.connection.quota_bucket_refs = vec!["a".into()];
        assert!(!eligible(&a, &b, &p));
        b = candidate("b");
        b.connection.connection_mode = "router".into();
        assert!(!eligible(&a, &b, &p));
        b = candidate("b");
        b.connection.provider_id = "claude".into();
        assert!(!eligible(&a, &b, &p));
        b = candidate("b");
        b.connection.access_state = "pending".into();
        assert!(!eligible(&a, &b, &p));
        let lease = crate::ai::begin_stream("routing-test").unwrap();
        let mut calls = Vec::new();
        let mut events = Vec::new();
        let result = run(
            "task",
            &[a.clone(), candidate("b")],
            &p,
            &lease,
            |a, _| {
                events.push(a.status.clone());
                Ok(())
            },
            |a, _| {
                calls.push(a.id.clone());
                if a.id == "a" {
                    Err("[RATE_LIMIT retry_after_ms=1000] fixture".into())
                } else {
                    Ok("OK")
                }
            },
        );
        assert_eq!(result.unwrap(), "OK");
        assert_eq!(calls, ["a", "b"]);
        assert_eq!(events, ["started", "rate_limited", "started", "succeeded"]);
        for error in [
            "[BILLING] limit",
            "[SAFETY] refusal",
            "[VALIDATION] schema",
            "[UNKNOWN_RESULT] timeout",
            "partial response",
        ] {
            let mut count = 0;
            assert!(run::<()>(
                "task",
                &[a.clone(), candidate("b")],
                &p,
                &lease,
                |_, _| Ok(()),
                |_, _| {
                    count += 1;
                    Err(error.into())
                }
            )
            .is_err());
            assert_eq!(count, 1);
        }
        crate::ai::cancel_ai_stream("routing-test");
        assert!(run::<()>(
            "task",
            &[a],
            &p,
            &lease,
            |_, _| Ok(()),
            |_, _| panic!("cancelled task ran")
        )
        .is_err());
    }
    #[test]
    fn exhausted_selected_account_is_skipped_and_other_providers_are_never_used() {
        let mut a = candidate("blocked-a"); a.blocked_until = now_ms() + 60000;
        let b = candidate("available-b");
        let mut other = candidate("other-c"); other.connection.provider_id = "claude".into();
        let mut policy = policy(); policy.ordered_profile_ids = vec!["available-b".into(), "other-c".into()];
        let lease = crate::ai::begin_stream("skip-exhausted-fixture").unwrap();
        let mut calls = vec![];
        let value = run("task", &[a,b,other], &policy, &lease, |_,_| Ok(()), |p,_| { calls.push(p.id.clone()); Ok("model") }).unwrap();
        assert_eq!(value,"model"); assert_eq!(calls, ["available-b"]);
    }

    #[test]
    fn leases_are_atomic_and_release_capacity() {
        let a = candidate("lease-a");
        let mut b = candidate("lease-b");
        b.connection.quota_bucket_refs = a.connection.quota_bucket_refs.clone();
        let lease = CapacityLease::acquire(&a.connection).unwrap();
        assert!(CapacityLease::acquire(&a.connection).is_err());
        assert!(CapacityLease::acquire(&b.connection).is_err());
        drop(lease);
        assert!(CapacityLease::acquire(&b.connection).is_ok());
    }
}

#[cfg(test)]
mod keychain_failure_tests {
    #[test]
    fn os_authorization_does_not_revoke_the_provider_account() {
        assert_ne!(super::Failure::classify("[KEYCHAIN_LOCKED] Uji koneksi"), super::Failure::Authentication);
        assert_eq!(super::Failure::classify("[AUTH] Credential dicabut"), super::Failure::Authentication);
    }
}
