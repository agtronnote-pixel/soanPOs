#!/usr/bin/env node
/* Soan Kofe POS — Server Lokal
   Menjalankan aplikasi POS di jaringan WiFi kedai, menyinkronkan data antar perangkat secara
   real-time, menyimpan file (gambar, dokumen), dan membuat laporan CSV penjualan harian.
   Tidak butuh internet dan tidak butuh paket tambahan: cukup Node.js versi 18 ke atas.
   Jalankan:  node server.js        (port bawaan 8080, ubah dengan PORT=9000 node server.js) */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), url = require('url');

const VERSION = '1.0.0';
const PORT = +process.env.PORT || 8080;
const HERE = __dirname;
const APP_DIR = [path.join(HERE, 'app'), path.join(HERE, '..')].find(d => fs.existsSync(path.join(d, 'index.html')));
const DATA_DIR = process.env.SOAN_DATA || path.join(HERE, 'data');
const FILE_DIR = path.join(DATA_DIR, 'files');
const BACKUP_DIR = path.join(DATA_DIR, 'cadangan');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const FOLDERS = ['gambar', 'laporan', 'dokumen'];
[DATA_DIR, FILE_DIR, BACKUP_DIR, ...FOLDERS.map(f => path.join(FILE_DIR, f))].forEach(d => fs.mkdirSync(d, { recursive: true }));

/* ---------- penyimpanan data ---------- */
let store = { code: null, clock: 0, items: {} };
try { store = Object.assign(store, JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))); } catch (e) {
  if (fs.existsSync(STORE_FILE)) { const bad = STORE_FILE + '.rusak-' + Date.now(); fs.copyFileSync(STORE_FILE, bad); console.error('store.json tidak terbaca, disalin ke', bad); }
}
let saveTimer = null;
function saveStore(now) {
  clearTimeout(saveTimer);
  const doSave = () => {
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, STORE_FILE);
    const day = new Date().toISOString().slice(0, 10), bk = path.join(BACKUP_DIR, 'data-' + day + '.json');
    if (!fs.existsSync(bk)) { fs.copyFileSync(STORE_FILE, bk); pruneBackups(); }
  };
  if (now) doSave(); else saveTimer = setTimeout(doSave, 300);
}
function pruneBackups() {
  const list = fs.readdirSync(BACKUP_DIR).filter(f => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  while (list.length > 60) fs.unlinkSync(path.join(BACKUP_DIR, list.shift()));
}
const tick = () => (store.clock = Math.max(store.clock + 1, Date.now()));
const since = ms => Object.values(store.items).filter(x => x.u > ms).sort((a, b) => a.u - b.u);

/* ---------- real-time (Server-Sent Events) ---------- */
const clients = new Set();
function broadcast(list) {
  const msg = 'data: ' + JSON.stringify(list) + '\n\n';
  for (const c of clients) c.write(msg);
}
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000);

/* ---------- laporan CSV otomatis ---------- */
let csvTimer = null; const dirtyDays = new Set();
const pad = n => String(n).padStart(2, '0');
const dayOf = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const csvCell = v => { v = v == null ? '' : String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function parsed(prefix) { return Object.values(store.items).filter(x => x.k.startsWith(prefix) && !x.del).map(x => { try { return JSON.parse(x.j); } catch (e) { return null; } }).filter(Boolean); }
function writeDailyCsv(day) {
  const users = Object.fromEntries(parsed('users~').map(u => [u.id, u.name]));
  const sales = parsed('sales~').filter(s => s.ts && dayOf(s.ts) === day).sort((a, b) => a.ts - b.ts);
  const file = path.join(FILE_DIR, 'laporan', 'penjualan-' + day + '.csv');
  if (!sales.length) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
  const head = ['No struk', 'Tanggal', 'Jam', 'Kasir', 'Tipe', 'Meja', 'Item', 'Jumlah item', 'Subtotal', 'Diskon', 'Layanan', 'Pajak', 'Total', 'Metode', 'Status'];
  const rows = sales.map(s => { const d = new Date(s.ts); const items = (s.items || []);
    return [s.no, day, pad(d.getHours()) + ':' + pad(d.getMinutes()), users[s.userId] || s.userId || '', s.type || '', s.table || '',
      items.map(i => i.name + ' x' + i.qty).join('; '), items.reduce((a, i) => a + (+i.qty || 0), 0),
      s.subtotal ?? '', s.discount ?? '', s.service ?? '', s.tax ?? '', s.total ?? '', s.method || '', s.status === 'void' ? 'Batal' : 'Lunas']; });
  const paid = sales.filter(s => s.status !== 'void');
  rows.push([]); rows.push(['TOTAL HARI INI', day, '', '', '', '', paid.length + ' transaksi lunas', '', '', '', '', '', paid.reduce((a, s) => a + (+s.total || 0), 0), '', '']);
  fs.writeFileSync(file, '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
}
function writeMonthlyRecap(month) {
  const sales = parsed('sales~').filter(s => s.ts && dayOf(s.ts).startsWith(month) && s.status !== 'void');
  const file = path.join(FILE_DIR, 'laporan', 'rekap-bulanan-' + month + '.csv');
  if (!sales.length) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
  const by = {};
  sales.forEach(s => { const d = dayOf(s.ts); const r = by[d] || (by[d] = { n: 0, total: 0, m: {} }); r.n++; r.total += +s.total || 0; r.m[s.method] = (r.m[s.method] || 0) + (+s.total || 0); });
  const methods = ['cash', 'qris', 'debit', 'transfer'];
  const head = ['Tanggal', 'Transaksi', 'Total', 'Tunai', 'QRIS', 'Debit', 'Transfer'];
  const days = Object.keys(by).sort();
  const rows = days.map(d => [d, by[d].n, by[d].total, ...methods.map(m => by[d].m[m] || 0)]);
  rows.push(['TOTAL', days.reduce((a, d) => a + by[d].n, 0), days.reduce((a, d) => a + by[d].total, 0), ...methods.map(m => days.reduce((a, d) => a + (by[d].m[m] || 0), 0))]);
  fs.writeFileSync(file, '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
}
function queueCsv(days) {
  days.forEach(d => dirtyDays.add(d));
  clearTimeout(csvTimer);
  csvTimer = setTimeout(() => {
    const months = new Set();
    for (const d of dirtyDays) { try { writeDailyCsv(d); months.add(d.slice(0, 7)); } catch (e) { console.error('CSV gagal', d, e.message); } }
    for (const m of months) { try { writeMonthlyRecap(m); } catch (e) { console.error('Rekap gagal', m, e.message); } }
    dirtyDays.clear();
  }, 1500);
}
function rebuildAllCsv() { const days = new Set(parsed('sales~').filter(s => s.ts).map(s => dayOf(s.ts))); queueCsv([...days]); }

/* ---------- utilitas HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
function send(res, code, body, type) { res.writeHead(code, { 'content-type': type || 'application/json', 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
function readBody(req, limit) {
  return new Promise((ok, no) => { const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { no(Object.assign(new Error('Berkas terlalu besar'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks))); req.on('error', no); });
}
const safeName = n => String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 120);
function checkCode(req, q) {
  const code = String(req.headers['x-store-code'] || q.code || '').toLowerCase();
  if (!store.code) return { ok: true, code };
  return { ok: code === store.code, code };
}
function serveFile(res, file, download) {
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) return send(res, 404, { error: 'Tidak ditemukan' });
    const h = { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' };
    if (download) h['content-disposition'] = 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(path.basename(file));
    res.writeHead(200, h); fs.createReadStream(file).pipe(res);
  });
}
function listFiles() {
  const out = [];
  for (const f of FOLDERS) for (const name of fs.readdirSync(path.join(FILE_DIR, f))) {
    const st = fs.statSync(path.join(FILE_DIR, f, name)); if (st.isFile()) out.push({ folder: f, name, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/* ---------- rute ---------- */
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true), p = decodeURIComponent(u.pathname), q = u.query;
  try {
    if (p === '/api/info') return send(res, 200, { name: 'soan-server', version: VERSION, hasData: !!store.code, items: Object.keys(store.items).length });

    if (p.startsWith('/api/')) {
      const auth = checkCode(req, q);
      if (!auth.ok) return send(res, 403, { error: 'Kode toko salah' });

      if (p === '/api/items' && req.method === 'GET') {
        let list = since(+q.since || 0); if (q.limit) list = list.slice(0, +q.limit);
        return send(res, 200, list);
      }
      if (p === '/api/items' && req.method === 'POST') {
        const ops = JSON.parse((await readBody(req, 50e6)).toString('utf8'));
        if (!Array.isArray(ops)) return send(res, 400, { error: 'Format salah' });
        if (!store.code) { if (!/^[a-z0-9-]{8,40}$/.test(auth.code)) return send(res, 400, { error: 'Kode toko tidak valid' }); store.code = auth.code; }
        const changed = [], days = new Set();
        for (const o of ops) {
          if (!o || typeof o.k !== 'string') continue;
          const prev = store.items[o.k];
          const it = { k: o.k, j: o.del ? '' : String(o.j || ''), del: !!o.del, dev: String(o.dev || ''), u: tick() };
          store.items[o.k] = it; changed.push(it);
          if (o.k.startsWith('sales~')) { for (const src of [it, prev]) { try { const s = src && src.j && JSON.parse(src.j); if (s && s.ts) days.add(dayOf(s.ts)); } catch (e) {} } }
          if (o.k.startsWith('users~')) rebuildAllCsv();
        }
        saveStore(); broadcast(changed); if (days.size) queueCsv([...days]);
        return send(res, 200, { ok: true, n: changed.length, u: store.clock });
      }
      if (p === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write('retry: 3000\n\n');
        res.write('data: ' + JSON.stringify(since(+q.since || 0)) + '\n\n');
        clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      if (p === '/api/files' && req.method === 'GET') return send(res, 200, listFiles());
      if (p === '/api/files' && req.method === 'POST') {
        const folder = FOLDERS.includes(q.folder) ? q.folder : 'dokumen';
        let name = safeName(q.name); if (!name) return send(res, 400, { error: 'Nama berkas kosong' });
        const body = await readBody(req, 100e6);
        let target = path.join(FILE_DIR, folder, name);
        if (fs.existsSync(target)) { const ext = path.extname(name), base = name.slice(0, name.length - ext.length); let i = 2; while (fs.existsSync(path.join(FILE_DIR, folder, base + ' (' + i + ')' + ext))) i++; name = base + ' (' + i + ')' + ext; target = path.join(FILE_DIR, folder, name); }
        fs.writeFileSync(target, body);
        return send(res, 200, { ok: true, folder, name });
      }
      if (p === '/api/files' && req.method === 'DELETE') {
        const folder = FOLDERS.includes(q.folder) ? q.folder : null, name = safeName(q.name);
        if (!folder || !name) return send(res, 400, { error: 'Berkas tidak valid' });
        const target = path.join(FILE_DIR, folder, name); if (fs.existsSync(target)) fs.unlinkSync(target);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/reports/rebuild' && req.method === 'POST') { rebuildAllCsv(); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'Tidak ditemukan' });
    }

    if (p.startsWith('/files/')) {
      const parts = p.split('/'), folder = parts[2], name = safeName(parts.slice(3).join('/'));
      const auth = checkCode(req, q); if (!auth.ok) return send(res, 403, 'Kode toko salah', 'text/plain; charset=utf-8');
      if (!FOLDERS.includes(folder) || !name) return send(res, 404, 'Tidak ditemukan', 'text/plain; charset=utf-8');
      return serveFile(res, path.join(FILE_DIR, folder, name), q.dl === '1');
    }

    if (!APP_DIR) return send(res, 500, 'Folder aplikasi (index.html) tidak ditemukan', 'text/plain; charset=utf-8');
    const rel = p === '/' ? 'index.html' : path.normalize(p).replace(/^([/\\])+/, '');
    const file = path.join(APP_DIR, rel);
    if (!file.startsWith(APP_DIR) || /(^|[/\\])(server|data|\.git)([/\\]|$)/.test(rel)) return send(res, 404, 'Tidak ditemukan', 'text/plain; charset=utf-8');
    return serveFile(res, file, false);
  } catch (e) {
    console.error(e); send(res, e.status || 500, { error: e.message || 'Kesalahan server' });
  }
});

function lanAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddrs();
  console.log('\n  ☕  Soan Kofe POS — Server Lokal v' + VERSION);
  console.log('  ------------------------------------------------');
  console.log('  Buka di perangkat yang tersambung ke WiFi yang sama:');
  (ips.length ? ips : ['(belum tersambung ke jaringan)']).forEach(ip => console.log('     http://' + ip + ':' + PORT));
  console.log('  Di komputer ini sendiri:  http://localhost:' + PORT);
  console.log('  Data & berkas disimpan di: ' + DATA_DIR);
  console.log('  ' + (store.code ? 'Data toko: ' + Object.keys(store.items).length + ' catatan.' : 'Belum ada data toko. Aktifkan sinkron dari tablet kasir.'));
  console.log('  Biarkan jendela ini terbuka selama kedai beroperasi.\n');
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' sudah dipakai. Server mungkin sudah berjalan di jendela lain.' : e.message); process.exit(1); });
const bye = () => { try { saveStore(true); } catch (e) {} process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
