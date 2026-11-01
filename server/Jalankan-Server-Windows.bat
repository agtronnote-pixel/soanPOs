@echo off
title Soan Kofe POS - Server Lokal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js belum terpasang di komputer ini.
  echo   Unduh dari https://nodejs.org ^(pilih versi LTS^), pasang, lalu klik dua kali file ini lagi.
  echo.
  pause
  exit /b 1
)
node server.js
pause
