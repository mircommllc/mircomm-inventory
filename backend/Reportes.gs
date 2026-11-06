/**
 * MirComm — Reportes de Cellmart guardados (Core, Mobile y Commission).
 *
 * Guarda en la pestaña "Reportes_Cellmart" de la hoja MirComm Inventory el último Core Report,
 * el último Mobile Report y el historial de Commission Reports (la app junta los pagos sin duplicar).
 * Así la página de Activaciones los muestra siempre, en la computadora o en el teléfono,
 * sin volver a subirlos. Solo el manager puede guardarlos o leerlos.
 *
 * Usa: authSession_ (Activaciones.gs), SPREADSHEET_ID (Code.gs).
 *
 * INSTALAR (una sola vez):
 *  1. Apps Script: ＋ → Script → nómbralo "Reportes" → pega todo este archivo → Guardar.
 *  2. En Code.gs, dentro de doPost(e), pega esta línea como PRIMERA línea,
 *     justo debajo de  function doPost(e) {
 *        var rp = reportesRouter_(e); if (rp) return rp;
 *  3. Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar.
 */

var REP_SHEET = 'Reportes_Cellmart';
var REP_HEADERS = ['Tipo', 'Parte', 'Archivo', 'Guardado', 'Datos'];
var REP_TIPOS = { core: 1, mobile: 1, commission: 1 };
var REP_CHUNK = 45000;          // una celda aguanta 50,000 caracteres

function reportesRouter_(e) {
  var body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents) || {}; } catch (err) { return null; }
  }
  var a = String(body.action || '');
  if (a !== 'repSave' && a !== 'repGet') return null;
  var out;
  try {
    var ses = typeof authSession_ === 'function' ? authSession_(body.mt) : null;
    if (!ses) out = { error: 'Tu sesión venció. Entra otra vez con tu PIN.', code: 'AUTH' };
    else if (!ses.manager) out = { error: 'Esta opción es solo para el manager.', code: 'AUTH' };
    else out = a === 'repSave' ? repSave_(body) : repGet_();
  } catch (err) {
    out = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function repSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(REP_SHEET);
  if (!sh) {
    sh = ss.insertSheet(REP_SHEET);
    sh.getRange(1, 1, 1, REP_HEADERS.length).setValues([REP_HEADERS]).setFontWeight('bold');
    sh.getRange(1, 1, sh.getMaxRows(), REP_HEADERS.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Reemplaza el reporte guardado de ese tipo. body: { tipo, archivo, grid: [[...], ...] } */
function repSave_(body) {
  var tipo = String(body.tipo || '');
  if (!REP_TIPOS[tipo]) throw new Error('Tipo de reporte desconocido: ' + tipo);
  if (!body.grid || !body.grid.length) throw new Error('El reporte viene vacío.');
  var json = JSON.stringify(body.grid);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = repSheet_();
    var last = sh.getLastRow();
    var keep = last > 1 ? sh.getRange(2, 1, last - 1, REP_HEADERS.length).getValues().filter(function (r) { return r[0] && r[0] !== tipo; }) : [];
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    var archivo = String(body.archivo || '').slice(0, 200);
    for (var i = 0, n = 0; i < json.length; i += REP_CHUNK, n++) {
      // la "j" de adelante evita que Sheets tome el pedazo como fórmula o número
      keep.push([tipo, n, archivo, now, 'j' + json.slice(i, i + REP_CHUNK)]);
    }
    if (last > 1) sh.getRange(2, 1, last - 1, REP_HEADERS.length).clearContent();
    sh.getRange(2, 1, keep.length, REP_HEADERS.length).setNumberFormat('@').setValues(keep);
    return { ok: true, tipo: tipo, guardado: now, partes: Math.ceil(json.length / REP_CHUNK) };
  } finally {
    lock.releaseLock();
  }
}

/** Devuelve { reports: { core: {archivo, guardado, grid}, mobile: ..., commission: ... } } */
function repGet_() {
  var sh = repSheet_();
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, REP_HEADERS.length).getValues() : [];
  var by = {};
  rows.forEach(function (r) {
    if (!REP_TIPOS[r[0]]) return;
    var t = by[r[0]] = by[r[0]] || { archivo: String(r[2]), guardado: String(r[3]), parts: [] };
    t.parts[+r[1]] = String(r[4]).replace(/^j/, '');
  });
  var out = {};
  Object.keys(by).forEach(function (k) {
    try { out[k] = { archivo: by[k].archivo, guardado: by[k].guardado, grid: JSON.parse(by[k].parts.join('')) }; } catch (err) {}
  });
  return { reports: out };
}

