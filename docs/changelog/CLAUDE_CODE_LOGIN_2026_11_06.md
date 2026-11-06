# Login Claude melalui Claude Code (seperti Orca) — 6 November 2026

Sebelumnya, Claude di ForgeKit hanya bisa dihubungkan dengan kunci API dari Claude Console. Sekarang tombol **Connect** pada kartu Claude masuk dengan langganan Claude melalui Claude Code CLI resmi, mengikuti cara Orca. Koneksi API tetap tersedia lewat tombol pengaturan lanjutan.

## Cara kerja

1. **Profil sendiri per akun.** Setiap akun memakai direktori pribadi `~/Library/Application Support/dev.forgekit.studio/claude-accounts/<id>` (izin 0700) yang dipasang sebagai `CLAUDE_CONFIG_DIR`. Login global `~/.claude` tidak dipakai atau diubah.
2. **Login.**
   - ForgeKit menjalankan `claude auth login --claudeai` di profil itu. Claude Code membuka browser, dan callback lokalnya menyelesaikan login.
   - Bila browser tidak bisa kembali, pengguna membuka "login manual" lalu menempelkan kode. Kode diteruskan ke stdin CLI dan tidak disimpan.
   - Setelah selesai, `claude auth status --json` dipakai untuk memverifikasi login langganan (`claude.ai`), email, dan organisasi.
3. **Token.** ForgeKit tidak pernah membaca, menyalin, atau mengirim token OAuth. Token disimpan Claude Code di penyimpanannya sendiri, terikat pada profil tersebut.
4. **Giliran model.**
   - Setiap giliran menjalankan `claude -p --input-format stream-json --output-format stream-json --include-partial-messages` dengan `--tools ""`, `--strict-mcp-config`, `--disable-slash-commands`, `--no-session-persistence`, `--safe-mode`, model alias (`opus` / `sonnet` / `haiku`), dan `--effort` opsional.
   - Environment proses dikosongkan, sehingga `ANTHROPIC_API_KEY` dan variabel lain dari shell tidak bisa mengalihkan profil.
   - Instruksi sistem ditulis ke berkas 0600 lalu dihapus setelah giliran selesai; isinya tidak pernah muncul di argumen proses.
5. **Tools ForgeKit.**
   - Tool tetap dijalankan oleh loop ForgeKit, sehingga persetujuan, anggaran, receipt, dan checkpoint tetap berlaku.
   - Model meminta tool dengan blok `<forgekit_tool_call>{"name":…,"input":…}</forgekit_tool_call>`, yang diubah menjadi tool call biasa.
   - Blok tool call tidak pernah ikut tampil di stream teks ke pengguna.
6. **Limit.** Event `rate_limit_event` dari Claude Code (jendela 5 jam dan mingguan) ditampilkan di panel usage. Status `rejected` dipetakan ke `[RATE_LIMIT]` dengan waktu reset.
7. **Putuskan akun.** ForgeKit menjalankan `claude auth logout` di profil itu, lalu menghapus direktorinya.

## Batas yang diketahui

- Claude Code harus sudah terpasang (`~/.local/bin/claude`, Homebrew, atau `PATH`). ForgeKit tidak mengunduhnya.
- Kepatuhan pada protokol tool bergantung pada model; balasan yang formatnya salah ditolak dengan pesan galat, bukan ditebak.
- Pemakaian mengikuti limit paket Claude akun tersebut.
- Login di aplikasi terpasang dan tugas chat atau kreasi dengan akun langganan belum diuji langsung saat perubahan ini ditulis. Protokol tool sudah dicoba dengan CLI 2.1.318.
