/* Service worker Soan Kofe POS: aplikasi tetap terbuka tanpa internet.
   Naikkan nomor VERSI saat Anda mengunggah versi baru agar cache lama dibersihkan. */
const VERSI = 'soankofe-v30';
const INTI = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSI).then(c => c.addAll(INTI)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Tampilkan dari cache lebih dulu, sambil memperbarui cache di latar belakang. */
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || !/^https?:/.test(r.url)) return;
  /* Jangan cache koneksi ke server (data & berkas); hanya file aplikasi dan font. */
  const h = new URL(r.url).hostname;
  if (h === self.location.hostname && /\/(api|files)\//.test(new URL(r.url).pathname)) return;
  /* Panel Developer selalu dari jaringan; konfigurasi tampilan: jaringan dulu, cadangan dari cache. */
  if (h === self.location.hostname && /\/developer\//.test(new URL(r.url).pathname)) return;
  if (h === self.location.hostname && /\/soan-config\.json$/.test(new URL(r.url).pathname)) {
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(VERSI).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r, { ignoreSearch: true })));
    return;
  }
  if (h !== self.location.hostname && !/^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(h)) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => {
    const net = fetch(r).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(VERSI).then(c => c.put(r, cp)); }
      return res;
    }).catch(() => hit);
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
