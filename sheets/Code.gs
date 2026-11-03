/* Soan Kofe POS ⇄ Google Sheets (versi 1)
   Cara pasang: buka Google Sheet → Ekstensi → Apps Script → hapus isi Code.gs → tempel kode ini
   → Simpan → Terapkan (Deploy) → Deployment baru → Jenis: Aplikasi web
   → Jalankan sebagai: Saya · Yang memiliki akses: Siapa saja → Terapkan → salin URL aplikasi web ke POS.
   Kode rahasia di bawah HARUS sama dengan yang tertulis di POS (Pengaturan → Google Sheets). */
const KODE = '__KODE__';
const TAB_INPUT = 'Input Inventory';
const HEAD_INPUT = ['Tanggal', 'Nama bahan', 'Jenis', 'Jumlah', 'Satuan', 'Catatan', 'Oleh', 'Status'];
const JENIS = ['Opname', 'Restock', 'Rusak', 'Bahan baru'];

function keluar(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return keluar({ ok: true, app: 'soan-sheet', v: 1 }); }
function doPost(e) {
  let q;
  try { q = JSON.parse(e.postData.contents); } catch (x) { return keluar({ ok: false, err: 'Permintaan tidak valid' }); }
  if (!q || q.kode !== KODE) return keluar({ ok: false, err: 'Kode rahasia salah' });
  const ss = SpreadsheetApp.getActiveSpreadsheet(), lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    siapkan(ss);
    if (q.a === 'ping') return keluar({ ok: true, app: 'soan-sheet', v: 1, nama: ss.getName() });
    if (q.a === 'tulis') { Object.keys(q.tab || {}).forEach(n => tulisTab(ss, n, q.tab[n])); return keluar({ ok: true }); }
    if (q.a === 'ambil') return keluar({ ok: true, rows: ambil(ss, String(q.dev || 'POS')) });
    if (q.a === 'hasil') { hasil(ss, q.rows || []); return keluar({ ok: true }); }
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
