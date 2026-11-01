# Soan Kofe POS — aturan kerja untuk Claude

Aplikasi kasir (POS) coffee shop Soan Kofe. Pemilik dan developer berbahasa Indonesia:
semua teks aplikasi, pesan commit, komentar Issue/PR ditulis dalam **bahasa Indonesia** yang sederhana.

## Struktur
- `index.html` — seluruh aplikasi (HTML + CSS + JS dalam satu file, tanpa framework, tanpa build).
- `sw.js` — service worker (offline). **Naikkan `VERSI`** (mis. soankofe-v5 → v6) setiap kali file aplikasi berubah.
- `manifest.webmanifest`, `icons/` — PWA.
- `server/server.js` — Server Lokal (Node.js, tanpa paket tambahan): sinkron real-time (SSE),
  berkas, laporan CSV, cadangan Google Drive & .zip. Lihat `server/PANDUAN.txt`.
- Situs dipublikasikan oleh GitHub Pages dari branch `main`.

## Aturan data (WAJIB, data toko asli tersimpan di perangkat dan server)
- Jangan ganti nama kunci penyimpanan: `soankofe.pos.v1`, `soankofe.pos.sync`, `soankofe.pos.syncbase`, `soankofe.pos.session`.
- Perubahan struktur data harus lewat fungsi `migrate(d)` dan aman untuk data lama; jangan hapus field yang ada.
- Jangan ubah format catatan sinkron `{k, j, del, u, dev}` atau API server (`/api/items`, `/api/stream`, `/api/files`, `/api/backup.zip`) tanpa tetap kompatibel dengan versi lama.
- Jangan menambah layanan pihak ketiga (Firebase, analytics, CDN baru) kecuali diminta jelas di Issue.

## Cara kerja
- Ikuti gaya kode yang ada (fungsi kecil, `ACT[...]` untuk aksi tombol, `VIEWS[...]` untuk halaman, `esc()` untuk teks pengguna).
- Tampilan harus rapi di HP (390px), tablet, dan laptop.
- Sebelum selesai: cek sintaks (`node -e` memuat setiap `<script>` dengan `new Function`), `node --check sw.js server/server.js`.
- Selesai bekerja: balas di Issue dengan ringkasan singkat (apa yang berubah, cara mencobanya) dan link Pull Request.
  Jangan push langsung ke `main`.
