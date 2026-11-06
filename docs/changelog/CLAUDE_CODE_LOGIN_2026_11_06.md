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

## Perbaikan 0.1.51 (setelah uji login pertama)

- **Model asli akun langsung terbaca saat tersambung.** ForgeKit menjalankan perintah lokal Claude Code `/model` di profil akun (tanpa request ke model). Daftarnya disimpan di profil dan dibaca ulang saat tombol refresh ditekan. Contoh: Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1, beserta varian konteks 1M.
- **Usage paket langsung terbaca, tanpa menunggu chat pertama.** Dibaca dari `/usage` Claude Code: sesi 5 jam, mingguan, dan mingguan per model (misalnya Fable), lengkap dengan waktu reset dan nama paket. Hasilnya disimpan 60 detik dan diperbarui oleh event limit setiap tugas.
- **Usage tidak hilang setelah profil diedit.** Cache usage kini memakai akun Claude Code sebagai kunci, bukan waktu `updated_at` profil.
- **Chat tidak lagi gagal dengan `FOREIGN KEY constraint failed`.**
  - Penyebabnya, halaman chat mengingat ID percakapan dari database yang sudah terhapus.
  - Sekarang ID yang tidak ada di daftar percakapan diabaikan dan percakapan baru dibuat otomatis.
  - Backend juga menolak dengan pesan yang jelas, bukan galat SQLite mentah.

## Perbaikan 0.1.52

- **Semua model akun tampil.**
  - Selain alias (Opus, Sonnet, Haiku, Fable, dan varian konteks 1M), ForgeKit memeriksa model ber-ID tetap yang dikenal Claude Code (Opus 5/4.8/4.7/4.6/4.5, Sonnet 5/4.6/4.5, Haiku 4.5, dan seterusnya) dengan `/model <id>` dalam satu sesi Claude Code, tanpa request ke model.
  - Model yang tidak tersedia untuk akun ("not found") atau yang dialihkan diam-diam ke model lain tidak ditampilkan.
  - Pada akun uji terbaca 16 model.
- **Mode chat (Kerjakan / Tanya / Rencanakan) dihapus.**
  - Semua prompt dikirim dalam satu mode otomatis. AI menentukan dari prompt apakah perlu menjawab, membuat rencana, atau mengerjakan perubahan.
  - Setiap perubahan pada map atau sistem tetap meminta izin pengguna.

## Batas yang diketahui

- Claude Code harus sudah terpasang (`~/.local/bin/claude`, Homebrew, atau `PATH`). ForgeKit tidak mengunduhnya.
- Kepatuhan pada protokol tool bergantung pada model; balasan yang formatnya salah ditolak dengan pesan galat, bukan ditebak.
- Pemakaian mengikuti limit paket Claude akun tersebut.
- Login di aplikasi terpasang dan tugas chat atau kreasi dengan akun langganan belum diuji langsung saat perubahan ini ditulis. Protokol tool sudah dicoba dengan CLI 2.1.318.
