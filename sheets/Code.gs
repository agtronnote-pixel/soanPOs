/* Soan Kofe POS ⇄ Google Sheets (versi 3: laporan, input inventory, sinkron antar perangkat, Asisten AI)
   Cara pasang: buka Google Sheet → Ekstensi → Apps Script → hapus isi Code.gs → tempel kode ini
   → Simpan → Terapkan (Deploy) → Deployment baru → Jenis: Aplikasi web
   → Jalankan sebagai: Saya · Yang memiliki akses: Siapa saja → Terapkan → salin URL aplikasi web ke POS.
   Kode rahasia di bawah HARUS sama dengan yang tertulis di POS (Pengaturan → Google Sheets).
   Memperbarui kode: tempel kode baru → Simpan → Terapkan → Kelola deployment → Edit (pensil)
   → Versi: Versi baru → Terapkan (URL tetap sama).
   Tab tersembunyi "_sinkron" berisi data toko untuk sinkron antar perangkat: JANGAN diedit / dihapus.
   Asisten AI (foto struk): kunci API Claude disimpan di Properti Skrip (bukan di POS), diisi dari
   POS → Pengaturan → Asisten AI. Saat pertama memperbarui ke versi 3, Google meminta izin
   "terhubung ke layanan eksternal" — izinkan. */
const KODE = '__KODE__';
const TAB_INPUT = 'Input Inventory';
const HEAD_INPUT = ['Tanggal', 'Nama bahan', 'Jenis', 'Jumlah', 'Satuan', 'Catatan', 'Oleh', 'Status'];
const JENIS = ['Opname', 'Restock', 'Rusak', 'Bahan baru'];
const TAB_SYNC = '_sinkron', POTONG = 45000; // batas isi 1 sel Google Sheets ±50.000 karakter
const AI_URL = 'https://api.anthropic.com/v1/messages', AI_MODEL = ['claude-haiku-5-5', 'claude-sonnet-5-5'];

function keluar(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return keluar({ ok: true, app: 'soan-sheet', v: 3 }); }
function doPost(e) {
  let q;
  try { q = JSON.parse(e.postData.contents); } catch (x) { return keluar({ ok: false, err: 'Permintaan tidak valid' }); }
  if (!q || q.kode !== KODE) return keluar({ ok: false, err: 'Kode rahasia salah' });
  if (q.a === 'ai_kunci' || q.a === 'ai') { try { return keluar(q.a === 'ai' ? aiTanya(q.body) : aiKunci(q.key)); } catch (x) { return keluar({ ok: false, err: String((x && x.message) || x) }); } }
  const ss = SpreadsheetApp.getActiveSpreadsheet(), lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    siapkan(ss);
    if (q.a === 'ping') return keluar({ ok: true, app: 'soan-sheet', v: 3, nama: ss.getName(), ai: !!aiKey() });
    if (q.a === 'tulis') { Object.keys(q.tab || {}).forEach(n => tulisTab(ss, n, q.tab[n])); return keluar({ ok: true }); }
    if (q.a === 'ambil') return keluar({ ok: true, rows: ambil(ss, String(q.dev || 'POS')) });
    if (q.a === 'hasil') { hasil(ss, q.rows || []); return keluar({ ok: true }); }
    if (q.a === 'sync_get') return keluar(Object.assign({ ok: true }, syncAmbil(ss, +q.since || 0, Math.min(+q.limit || 1000, 3000))));
    if (q.a === 'sync_put') return keluar(Object.assign({ ok: true }, syncTulis(ss, q.ops || [])));
    return keluar({ ok: false, err: 'Perintah tidak dikenal' });
  } catch (x) { return keluar({ ok: false, err: String((x && x.message) || x) }); }
  finally { lock.releaseLock(); }
}
/* tab Input Inventory dibuat otomatis bila belum ada */
function siapkan(ss) {
  if (ss.getSheetByName(TAB_INPUT)) return;
  const sh = ss.insertSheet(TAB_INPUT, 0);
  sh.getRange(1, 1, 1, HEAD_INPUT.length).setValues([HEAD_INPUT]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(JENIS, true).setAllowInvalid(false).build());
  sh.setColumnWidth(2, 200); sh.setColumnWidth(8, 280);
}
/* tab laporan dari POS (Stok Bahan, Laporan Harian, Mutasi Stok): isinya diganti setiap kiriman */
function tulisTab(ss, nama, t) {
  if (nama === TAB_INPUT || !t || !Array.isArray(t.head)) return;
  const sh = ss.getSheetByName(nama) || ss.insertSheet(nama);
  sh.clearContents();
  const rows = [t.head].concat(t.rows || []).map(r => t.head.map((_, i) => (r[i] == null ? '' : r[i])));
  sh.getRange(1, 1, rows.length, t.head.length).setValues(rows);
  sh.getRange(1, 1, 1, t.head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (t.catatan) sh.getRange(1, t.head.length + 2).setValue(t.catatan);
}
/* ambil baris input yang belum diproses; ditandai ⏳ agar tidak diproses dua kali oleh perangkat lain */
function ambil(ss, dev) {
  const sh = ss.getSheetByName(TAB_INPUT), n = sh.getLastRow();
  if (n < 2) return [];
  const v = sh.getRange(2, 1, n - 1, HEAD_INPUT.length).getValues(), now = new Date(), out = [];
  v.forEach((r, i) => {
    const st = String(r[7] || ''), lama = /^⏳/.test(st) && now - new Date(st.split('|')[1] || 0) > 10 * 60 * 1000;
    if (!String(r[1] || '').trim() || (st && !lama)) return;
    const row = i + 2;
    sh.getRange(row, 8).setValue('⏳ diproses ' + dev + '|' + now.toISOString());
    const tg = r[0] ? new Date(r[0]).getTime() : null;
    out.push({ row, tgl: tg || null, nama: String(r[1]).trim(), jenis: String(r[2] || ''), jumlah: typeof r[3] === 'number' ? r[3] : String(r[3] == null ? '' : r[3]), satuan: String(r[4] || ''), catatan: String(r[5] || ''), oleh: String(r[6] || '') });
  });
  return out;
}
function hasil(ss, rows) {
  const sh = ss.getSheetByName(TAB_INPUT);
  rows.forEach(r => {
    if (!(r.row > 1)) return;
    sh.getRange(r.row, 8).setValue(String(r.status || ''));
    if (!sh.getRange(r.row, 1).getValue()) sh.getRange(r.row, 1).setValue(new Date());
  });
}

/* ---------- sinkron antar perangkat ----------
   Satu baris per catatan: A kunci · B hapus (1/0) · C perangkat · D u (urutan waktu) · E jumlah potongan · F.. isi JSON.
   Baris selalu urut menurut u (catatan yang berubah dihapus lalu ditambahkan di bawah),
   sehingga "ambil sejak u" cukup membaca bagian bawah tab. */
function tabSync(ss) {
  let sh = ss.getSheetByName(TAB_SYNC);
  if (!sh) { sh = ss.insertSheet(TAB_SYNC); sh.getRange(1, 1, 1, 6).setValues([['k', 'del', 'dev', 'u', 'n', 'j']]); sh.hideSheet(); }
  return sh;
}
function syncAmbil(ss, since, limit) {
  const sh = tabSync(ss), n = sh.getLastRow() - 1;
  if (n < 1) return { items: [], more: false };
  const us = sh.getRange(2, 4, n, 1).getValues().map(r => +r[0] || 0);
  let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (us[m] > since) hi = m; else lo = m + 1; }
  if (lo >= n) return { items: [], more: false };
  const cnt = Math.min(limit, n - lo), w = Math.max(6, sh.getLastColumn());
  const v = sh.getRange(lo + 2, 1, cnt, w).getValues();
  const items = v.map(r => { const p = Math.max(1, +r[4] || 1); let j = ''; for (let i = 0; i < p; i++) j += String(r[5 + i] == null ? '' : r[5 + i]); return { k: String(r[0]), del: r[1] === 1 || r[1] === true || r[1] === '1', dev: String(r[2] || ''), u: +r[3] || 0, j: r[1] === 1 || r[1] === '1' ? '' : j }; });
  return { items, more: lo + cnt < n };
}
function syncTulis(ss, ops) {
  const sh = tabSync(ss), n = sh.getLastRow() - 1, pr = PropertiesService.getScriptProperties();
  let clock = +pr.getProperty('clock') || 0;
  const pos = {};
  if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach((r, i) => { pos[String(r[0])] = i + 2; });
  const hapus = [], baru = [], seen = {};
  ops.forEach(o => { if (!o || typeof o.k !== 'string' || !o.k) return; if (seen[o.k] != null) baru[seen[o.k]] = null; if (pos[o.k]) { hapus.push(pos[o.k]); delete pos[o.k]; }
    clock = Math.max(Date.now(), clock + 1);
    const j = o.del ? '' : String(o.j || ''), parts = []; for (let i = 0; i < j.length; i += POTONG) parts.push(j.slice(i, i + POTONG)); if (!parts.length) parts.push('');
    seen[o.k] = baru.length; baru.push([o.k, o.del ? 1 : 0, String(o.dev || ''), clock, parts.length].concat(parts)); });
  hapus.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
  const rows = baru.filter(Boolean);
  if (rows.length) { const w = Math.max.apply(null, rows.map(r => r.length)); sh.getRange(sh.getLastRow() + 1, 1, rows.length, w).setValues(rows.map(r => r.concat(new Array(w - r.length).fill('')))); }
  pr.setProperty('clock', String(clock));
  return { n: rows.length, u: clock };
}

/* ---------- Asisten AI: meneruskan permintaan POS ke Claude API (kunci tidak pernah dikirim balik) ---------- */
function aiKey() { return PropertiesService.getScriptProperties().getProperty('AI_KEY') || ''; }
function aiKunci(key) {
  const p = PropertiesService.getScriptProperties(), k = String(key || '').trim();
  if (!k) { p.deleteProperty('AI_KEY'); return { ok: true, ai: false }; }
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) return { ok: false, err: 'Kunci API tidak valid (diawali sk-ant-)' };
  p.setProperty('AI_KEY', k); return { ok: true, ai: true };
}
function aiTanya(body) {
  const key = aiKey();
  if (!key) return { ok: false, err: 'Kunci API AI belum diisi (POS → Pengaturan → Asisten AI)' };
  if (!body || AI_MODEL.indexOf(body.model) < 0 || !Array.isArray(body.messages)) return { ok: false, err: 'Permintaan AI tidak valid' };
  body.max_tokens = Math.min(+body.max_tokens || 2000, 4000);
  const r = UrlFetchApp.fetch(AI_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(body) });
  let j = null; try { j = JSON.parse(r.getContentText()); } catch (x) {}
  if (r.getResponseCode() !== 200) return { ok: false, err: 'AI menjawab ' + r.getResponseCode() + ((j && j.error && j.error.message) ? ': ' + j.error.message : '') };
  return { ok: true, res: j };
}
