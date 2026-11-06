# Migrasi historis

`0015_provider_only_tasks.sql` adalah varian skema 14 dari build lain yang tidak pernah dimuat oleh `storage/mod.rs`. Build ini memakai `0015_fallback_and_cooldown.sql`, lalu `0016_connection_compatibility.sql` menyelaraskan kedua varian. File ini disimpan hanya sebagai catatan; jangan dijalankan manual.
