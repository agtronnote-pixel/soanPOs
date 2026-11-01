#!/bin/bash
# Klik dua kali file ini untuk menyalakan Server Lokal Soan Kofe POS di Mac.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js belum terpasang di Mac ini."
  echo "  Unduh dari https://nodejs.org (pilih versi LTS), pasang, lalu klik dua kali file ini lagi."
  echo ""
  read -p "  Tekan Enter untuk menutup..."
  exit 1
fi
# caffeinate menjaga Mac tidak tidur selama server berjalan
caffeinate -i node server.js
