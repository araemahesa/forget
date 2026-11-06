//! Bounded GET transport. Credentials travel over stdin, never argv or redirects.
use crate::ai;
use serde_json::Value;
use std::{collections::HashMap, io::{Read, Write}, process::{Command, Stdio}};

pub struct Response {
    pub status: u16,
    /// Quota-related headers only (filtered); kept for diagnostics and covered by tests.
    #[allow(dead_code)]
    pub headers: HashMap<String, String>,
    pub value: Value,
}
pub fn get(endpoint: &str, headers: &[(&str, &str)]) -> Result<Response, String> {
    let url = url::Url::parse(endpoint).map_err(|_| "URL usage tidak sah.")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]" | "::1"));
    if !(url.scheme() == "https" || url.scheme() == "http" && local)
        || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("URL usage harus HTTPS atau loopback lokal.".into());
    }
    let mut config = format!("url = {}\nheader = \"Accept: application/json\"\n", ai::curl_quote(endpoint));
    for (name, value) in headers {
        if name.chars().any(char::is_control) || value.chars().any(char::is_control) {
            return Err("Header usage tidak sah.".into());
        }
        config.push_str(&format!("header = {}\n", ai::curl_quote(&format!("{name}: {value}"))));
    }
    let mut child = Command::new("/usr/bin/curl")
        .args(["-q", "--silent", "--include", "--connect-timeout", "5", "--max-time", "15",
            "--max-redirs", "0", "--proto", "=http,https", "--config", "-"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|_| "Transport usage tidak dapat dimulai.")?;
    let result: Result<Vec<u8>, String> = (|| {
        child.stdin.take().ok_or("Input usage tidak tersedia.")?.write_all(config.as_bytes())
            .map_err(|_| "Transport usage menutup input.")?;
        let mut bytes = vec![];
        child.stdout.take().ok_or("Output usage tidak tersedia.")?.take(2_097_153).read_to_end(&mut bytes)
            .map_err(|_| "Respons usage terputus.")?;
        if bytes.len() > 2_097_152 { return Err("Respons usage terlalu besar.".into()); }
        Ok(bytes)
    })();
    if result.is_err() { let _ = child.kill(); }
    let success = child.wait().map_err(|_| "Status transport usage tidak tersedia.")?.success();
    let bytes = result?;
    if !success { return Err("Provider tidak terhubung atau pembacaan usage melewati batas waktu.".into()); }
    parse(&bytes)
}
fn parse(bytes: &[u8]) -> Result<Response, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Respons usage tidak sah.")?;
    let mut rest = text;
    let mut status = 0;
    let mut headers = HashMap::new();
    // curl can emit proxy CONNECT and informational headers before the response.
    while rest.starts_with("HTTP/") {
        let (block, body) = rest.split_once("\r\n\r\n").or_else(|| rest.split_once("\n\n"))
            .ok_or("Header usage tidak lengkap.")?;
        headers.clear();
        status = block.lines().next().and_then(|s| s.split_whitespace().nth(1))
            .and_then(|s| s.parse().ok()).unwrap_or(0);
        for line in block.lines().skip(1) {
            if let Some((name, value)) = line.split_once(':') {
                let name = name.to_ascii_lowercase();
                if super::is_quota_header(&name) && value.len() <= 200 {
                    headers.insert(name, value.trim().to_owned());
                }
            }
        }
        rest = body;
    }
    Ok(Response { status, headers, value: serde_json::from_str(rest).unwrap_or(Value::Null) })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_proxy_blocks_and_discards_secrets_and_untrusted_errors() {
        let r = parse(b"HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 403 Forbidden\r\nSet-Cookie: secret\r\nx-ratelimit-limit-tokens: 100\r\n\r\n{\"error\":\"secret\"}").unwrap();
        assert_eq!(r.status, 403);
        assert_eq!(r.headers.len(), 1);
        assert_eq!(r.headers["x-ratelimit-limit-tokens"], "100");
    }
    #[test]
    fn metadata_get_keeps_auth_out_of_url_and_does_not_follow_redirects() {
        use std::{net::TcpListener, thread};
        let destination = TcpListener::bind("127.0.0.1:0").unwrap();
        destination.set_nonblocking(true).unwrap();
        let source = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/metadata", source.local_addr().unwrap());
        let redirect = format!("http://{}/must-not-receive-token", destination.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut socket, _) = source.accept().unwrap();
            socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut buf = [0; 4096];
            let len = socket.read(&mut buf).unwrap();
            let request = std::str::from_utf8(&buf[..len]).unwrap();
            assert!(request.starts_with("GET /metadata HTTP/"));
            assert!(request.contains("Authorization: Bearer fixture-secret\r\n"));
            assert!(!request.contains("POST"));
            write!(socket, "HTTP/1.1 302 Found\r\nLocation: {redirect}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}").unwrap();
        });
        assert_eq!(get(&endpoint, &[("Authorization", "Bearer fixture-secret")]).unwrap().status, 302);
        server.join().unwrap();
        assert!(destination.accept().is_err());
    }
}
