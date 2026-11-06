/**
 * Credito.gs — A quién se le acredita una venta (MirComm Palmhurst)
 * -----------------------------------------------------------------------------
 * Separa QUIÉN ACTIVÓ la línea de QUIÉN LA TRABAJÓ. La comisión es de quien la trabajó.
 *
 * Regla del equipo:
 *   "La línea es de quien la anotó primero. Si nadie la anotó, es de quien la active."
 *
 *  - 📝 Línea ofrecida: cuando un cliente viene a pagar y no quiere la línea gratis ahorita, la asesora la anota
 *    (cuenta, nombre, teléfono). Vale 60 días.
 *  - Si otra persona activa la línea de ese cliente, la venta se le acredita sola a quien la anotó primero.
 *    También cuentan los prospectos (Prospectos) y "Contactado" en Internet sin línea (Seguimiento).
 *  - Joel puede cambiar el crédito de cualquier venta con un motivo. Las asesoras no pueden reasignar ventas.
 *  - Una venta que Joel ya cambió a mano nunca se vuelve a cambiar sola.
 *  - El crédito se guarda en "SoldBy" (Hecha por) de la hoja Activations, que es lo que usan Nómina y Mi pago.
 *    Quién activó se queda en "Employee" / "EnteredBy" (Rep ID de Spectrum), así el cotejo con Cellmart no cambia.
 *  - Cada cambio queda en la pestaña Cred_Cambios y en las Notas de la venta.
 *
 * Usa: actSheet_ (Activaciones.gs), isManagerToken_ (Activaciones.gs), prosAuth_ (Prospectos.gs), SPREADSHEET_ID (Code.gs).
 *
 * INSTALAR (una sola vez):
 *  1. Apps Script: ＋ → Script → nómbralo "Credito" → pega todo este archivo → Guardar.
 *  2. En Code.gs, dentro de doGet(e), pega esta línea JUSTO DEBAJO de  prosSessionPin_(e);
 *        var cr = creditoRouter_(e); if (cr) return cr;
 *  3. Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar.
 *  Las pestañas Cred_Ofrecidas y Cred_Cambios se crean solas la primera vez.
 */

// ─── CONFIGURACIÓN ─────────────────────────────────────────────────
var CRED_MANAGER = 'Joel';
var CRED_EQUIPO = ['Joel', 'Lizbeth'];   // se suman solos los usuarios de Prospectos (menos las bajas: STAFF_BAJAS en Prospectos.gs)
var CRED_DIAS = 60;                 // una línea anotada (o un prospecto) vale 60 días
var CRED_DESDE = '2026-10-14';      // el crédito automático solo toca ventas desde esta fecha (lo de antes ya se pagó)
var CRED_OF_SHEET = 'Cred_Ofrecidas';
var CRED_OF_HEADERS = ['ID', 'Fecha', 'Asesora', 'Cuenta', 'Nombre', 'Telefono', 'Nota', 'Estado', 'VentaID', 'Actualizado'];
var CRED_CH_SHEET = 'Cred_Cambios';
var CRED_CH_HEADERS = ['Fecha', 'ActID', 'FechaVenta', 'Cliente', 'Cuenta', 'Activo', 'De', 'A', 'Tipo', 'Motivo', 'Por'];

// ─── ROUTER ────────────────────────────────────────────────────────
// En Code.gs → doGet(e), justo debajo de prosSessionPin_(e):
//   var cr = creditoRouter_(e); if (cr) return cr;
function creditoRouter_(e) {
  var p = (e && e.parameter) || {};
  var a = String(p.action || '');
  if (a.indexOf('cred') !== 0) return null;
  var out;
  try {
    var me = credAuth_(p);
    if (a === 'credList') out = credList_(me);
    else if (a === 'credCheck') out = credCheck_(me, p);
    else if (a === 'credOffer') out = credLock_(function () { return credOffer_(me, p); });
    else if (a === 'credOfferClose') out = credLock_(function () { return credOfferClose_(me, p); });
    else if (a === 'credApply') out = credLock_(function () { return credRun_(me, { cuenta: p.cuenta, id: p.id }); });
    else if (a === 'credScan') out = credLock_(function () { if (!me.manager) throw new Error('Solo para el manager.'); return credRun_(me, {}); });
    else if (a === 'credSet') out = credLock_(function () { return credSet_(me, p); });
    else throw new Error('Acción desconocida: ' + a);
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Asesora: usuario + PIN de 6 dígitos (como Prospectos). Joel: su sesión de manager (mt).
function credAuth_(p) {
  if (!p.pin && typeof isManagerToken_ === 'function' && isManagerToken_(p.mt)) return { name: CRED_MANAGER, manager: true };
  if (typeof prosAuth_ !== 'function') throw new Error('Falta Prospectos.gs.');
  var me = prosAuth_(p);
  return { name: me.name, manager: !!me.manager };
}
function credLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ─── UTILIDADES ────────────────────────────────────────────────────
function credSS_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function credTz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }
function credNow_() { return Utilities.formatDate(new Date(), credTz_(), 'yyyy-MM-dd HH:mm'); }
function credToday_() { return Utilities.formatDate(new Date(), credTz_(), 'yyyy-MM-dd'); }
function credAddDays_(ymd, n) {
  var d = new Date(String(ymd).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, credTz_(), 'yyyy-MM-dd');
}
function credStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, credTz_(), v.getHours() || v.getMinutes() ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v).trim();
}
function credDigits_(v) { return String(v || '').replace(/\D/g, ''); }
function credPhones_(s) {
  return String(s || '').split(/[,;\/]+|\s{2,}/).map(function (x) { return credDigits_(x).slice(-10); })
    .filter(function (x) { return x.length === 10; });
}
// Fecha y hora normalizadas "yyyy-MM-dd HH:mm" (acepta "10/14/2026 3:05 PM" y fechas de la hoja)
function credTs_(v, fallbackTime) {
  var s = credStr_(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {           // ISO con zona (UTC): a hora local
    var dt = new Date(s);
    if (!isNaN(dt)) return Utilities.formatDate(dt, credTz_(), 'yyyy-MM-dd HH:mm');
  }
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3] + ' ' + (m[4] ? ('0' + m[4]).slice(-2) + ':' + m[5] : fallbackTime);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?/);
  if (m) {
    var h = m[4] ? +m[4] : null;
    if (h !== null && m[6]) { if (/p/i.test(m[6]) && h < 12) h += 12; if (/a/i.test(m[6]) && h === 12) h = 0; }
    return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) + ' ' + (h !== null ? ('0' + h).slice(-2) + ':' + m[5] : fallbackTime);
  }
  return '';
}
var CRED_STOP = { de: 1, del: 1, la: 1, las: 1, los: 1, el: 1, y: 1, jr: 1, sr: 1 };
function credNameTokens_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ ]+/g, ' ')
    .split(/\s+/).filter(function (t) { return t.length >= 3 && !CRED_STOP[t]; });
}
// Mismo cliente por nombre: al menos 2 palabras del nombre en común (nombre + apellido)
function credSameName_(a, b) {
  var ta = credNameTokens_(a), tb = credNameTokens_(b);
  if (ta.length < 2 || tb.length < 2) return false;
  var n = 0;
  ta.forEach(function (t) { if (tb.indexOf(t) >= 0) n++; });
  return n >= 2;
}
function credTeam_() {
  var team = CRED_EQUIPO.slice();
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('PROSPECTOS_CONFIG');
    var u = raw ? (JSON.parse(raw) || {}).usuarios || {} : {};
    Object.keys(u).forEach(function (n) { if (team.indexOf(n) < 0) team.push(n); });
  } catch (e) {}
  // v60: quien ya no trabaja aquí no sale para dar crédito ni recibe crédito automático (su historial no cambia).
  if (typeof staffEsBaja_ === 'function') team = team.filter(function (n) { return !staffEsBaja_(n); });
  return team;
}

// ─── HOJAS ─────────────────────────────────────────────────────────
function credSheet_(name, headers) {
  var ss = credSS_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
  if (missing.length) sh.getRange(1, have.filter(String).length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  return sh;
}
function credRead_(name, headers) {
  var sh = credSheet_(name, headers);
  return credReadSheet_(sh);
}
function credReadSheet_(sh) {
  var last = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), 1);
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var rows = [];
  if (last > 1) {
    sh.getRange(2, 1, last - 1, lastCol).getValues().forEach(function (r, i) {
      if (r.every(function (v) { return v === '' || v === null; })) return;
      var o = { _row: i + 2 };
      hdr.forEach(function (h, j) { if (h) o[h] = credStr_(r[j]); });
      rows.push(o);
    });
  }
  return { sh: sh, hdr: hdr, rows: rows };
}
function credWrite_(t, obj) {
  var row = t.hdr.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : String(obj[h]); });
  if (obj._row) t.sh.getRange(obj._row, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  else {
    var r = t.sh.getLastRow() + 1;
    t.sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    obj._row = r;
    t.rows.push(obj);
  }
  return obj;
}
function credClean_(o) { var c = {}; for (var k in o) if (k !== '_row') c[k] = o[k]; return c; }
function credActs_() {
  if (typeof actSheet_ !== 'function') throw new Error('Falta Activaciones.gs.');
  return credReadSheet_(actSheet_());
}
function credProspects_() {
  var sh = credSS_().getSheetByName('Prospectos');
  return sh && sh.getLastRow() > 1 ? credReadSheet_(sh).rows : [];
}
function credSinLinea_() {
  var sh = credSS_().getSheetByName('Seg_SinLinea');
  return sh && sh.getLastRow() > 1 ? credReadSheet_(sh).rows : [];
}

// Quién tiene hoy el crédito de la venta y quién la activó
function credOwner_(r) { return r.SoldBy || r.Employee || ''; }
function credActivator_(r) { return r.Source === 'Asesora' && r.EnteredBy ? r.EnteredBy : (r.Employee || r.SoldBy || ''); }

// ─── QUIÉN LA TRABAJÓ PRIMERO ──────────────────────────────────────
// c: { cuenta, phones[], nombre, fecha (yyyy-MM-dd), antes (yyyy-MM-dd HH:mm) }
// Devuelve la anotación más vieja de ese cliente dentro de los 60 días antes de la venta, o null.
function credFindWorker_(c, data) {
  var team = data.team, desde = credAddDays_(c.fecha, -CRED_DIAS), cands = [];
  var phoneHit = function (tel) { var t = credDigits_(tel).slice(-10); return t.length === 10 && c.phones.indexOf(t) >= 0; };
  var inWindow = function (ts) { return ts && ts.slice(0, 10) >= desde && ts < c.antes; };
  data.offers.forEach(function (o) {
    if (o.Estado === 'Cancelada' || team.indexOf(o.Asesora) < 0) return;
    if (o.Estado === 'Vendida' && o.VentaID && o.VentaID !== c.id) return;
    var ts = credTs_(o.Fecha, '00:00');
    if (!inWindow(ts)) return;
    var hit = (c.cuenta && credDigits_(o.Cuenta) === c.cuenta) || phoneHit(o.Telefono) || credSameName_(o.Nombre, c.nombre);
    if (hit) cands.push({ who: o.Asesora, ts: ts, fuente: 'Línea ofrecida', ofertaId: o.ID, nota: o.Nota || '' });
  });
  data.prospects.forEach(function (p) {
    if (p.Atribucion === 'Rechazada' || team.indexOf(p.Asesora) < 0) return;
    var ts = credTs_(p.Creado, '00:00');
    if (!inWindow(ts)) return;
    var hit = (c.cuenta && credDigits_(p.CuentaSpectrum) === c.cuenta) || phoneHit(p.Telefono) || credSameName_(p.Nombre, c.nombre);
    if (hit) cands.push({ who: p.Asesora, ts: ts, fuente: 'Prospecto', nota: p.Interes || '' });
  });
  data.sinLinea.forEach(function (m) {
    if (m.Estado !== 'Contactado' || team.indexOf(m.Por) < 0) return;
    var ts = credTs_(m.Fecha, '00:00');
    if (!inWindow(ts)) return;
    var k = String(m.Cuenta || '');
    var hit = (c.cuenta && k === c.cuenta) || (k.charAt(0) === 'T' && c.phones.indexOf(k.slice(1)) >= 0);
    if (hit) cands.push({ who: m.Por, ts: ts, fuente: 'Internet sin línea', nota: m.Nota || '' });
  });
  cands.sort(function (a, b) { return a.ts.localeCompare(b.ts); });
  return cands[0] || null;
}
function credData_() {
  return { team: credTeam_(), offers: credRead_(CRED_OF_SHEET, CRED_OF_HEADERS).rows,
           prospects: credProspects_(), sinLinea: credSinLinea_() };
}
function credClientOf_(r) {
  var fecha = String(r.OrderDate || '').slice(0, 10);
  return { id: r.ID, cuenta: credDigits_(r.AccountNumber), phones: credPhones_([r.Phone, r.LinePhones].join(',')),
           nombre: r.CustomerName || '', fecha: fecha, antes: credTs_(r.CreatedAt, '23:59') || (fecha + ' 23:59') };
}
function credSourceText_(w) {
  return w.fuente + ' del ' + w.ts.slice(5, 7) + '/' + w.ts.slice(8, 10) + (w.nota ? ' (' + String(w.nota).slice(0, 60) + ')' : '');
}

// ─── ESCRIBIR EL CRÉDITO ───────────────────────────────────────────
function credApplyTo_(acts, r, to, tipo, motivo, por) {
  var h = acts.hdr, cSold = h.indexOf('SoldBy'), cNotes = h.indexOf('Notes');
  if (cSold < 0) throw new Error('La hoja Activations no tiene la columna SoldBy.');
  var from = credOwner_(r);
  acts.sh.getRange(r._row, cSold + 1).setValue(to);
  if (cNotes >= 0) {
    var note = '[Crédito ' + credToday_().slice(5).replace('-', '/') + '] ' + (from || '—') + ' → ' + to + ': ' + motivo;
    acts.sh.getRange(r._row, cNotes + 1).setValue(r.Notes ? r.Notes + ' · ' + note : note);
    r.Notes = r.Notes ? r.Notes + ' · ' + note : note;
  }
  r.SoldBy = to;
  var ch = credRead_(CRED_CH_SHEET, CRED_CH_HEADERS);
  credWrite_(ch, { Fecha: credNow_(), ActID: r.ID, FechaVenta: String(r.OrderDate || '').slice(0, 10), Cliente: r.CustomerName || '',
    Cuenta: credDigits_(r.AccountNumber), Activo: credActivator_(r), De: from, A: to, Tipo: tipo, Motivo: motivo, Por: por });
}

// Crédito automático. f: { cuenta } (después de registrar una línea) o { id } o {} (todas las recientes, para Joel)
function credRun_(me, f) {
  var acts = credActs_(), data = credData_();
  var touched = {};
  credRead_(CRED_CH_SHEET, CRED_CH_HEADERS).rows.forEach(function (x) { touched[x.ActID] = 1; });
  var desde = [CRED_DESDE, credAddDays_(credToday_(), -45)].sort().pop();
  var cuenta = credDigits_(f.cuenta), out = [];
  var ofT = null;
  acts.rows.forEach(function (r) {
    if (!r.ID || touched[r.ID]) return;
    if (f.id && r.ID !== f.id) return;
    if (cuenta && credDigits_(r.AccountNumber) !== cuenta) return;
    var fecha = String(r.OrderDate || '').slice(0, 10);
    if (fecha < desde) return;
    if (!(+r.MobileLines > 0) || r.InternetTier || r.VideoTier) return;      // solo órdenes de línea móvil
    var w = credFindWorker_(credClientOf_(r), data);
    if (!w) return;
    var cur = credOwner_(r);
    if (w.ofertaId) {                                                         // la línea ofrecida ya se vendió
      ofT = ofT || credRead_(CRED_OF_SHEET, CRED_OF_HEADERS);
      var o = ofT.rows.filter(function (x) { return x.ID === w.ofertaId; })[0];
      if (o && o.Estado !== 'Vendida') { o.Estado = 'Vendida'; o.VentaID = r.ID; o.Actualizado = credNow_(); credWrite_(ofT, o); }
    }
    if (w.who === cur) { out.push({ id: r.ID, cliente: r.CustomerName, a: cur, mismo: true, fuente: credSourceText_(w) }); return; }
    credApplyTo_(acts, r, w.who, 'Auto', 'la tenía anotada ' + w.who + ' · ' + credSourceText_(w), me.name);
    touched[r.ID] = 1;
    out.push({ id: r.ID, cliente: r.CustomerName, de: cur, a: w.who, activo: credActivator_(r), fuente: credSourceText_(w) });
  });
  return { ok: true, cambios: out.filter(function (x) { return !x.mismo; }), confirmadas: out.filter(function (x) { return x.mismo; }) };
}

// Joel cambia el crédito a mano (con motivo). Después ya no se cambia sola.
function credSet_(me, p) {
  if (!me.manager) throw new Error('Solo Joel puede cambiar el crédito de una venta.');
  var to = String(p.to || '').trim(), motivo = String(p.motivo || '').trim().slice(0, 200);
  if (credTeam_().indexOf(to) < 0) throw new Error('Escoge a quién se le acredita.');
  if (!motivo) throw new Error('Escribe el motivo (ej. "se la ofrecí yo el 2 oct").');
  var acts = credActs_();
  var r = acts.rows.filter(function (x) { return x.ID === String(p.id || ''); })[0];
  if (!r) throw new Error('No encontré esa venta.');
  if (credOwner_(r) === to) throw new Error('Esa venta ya está a nombre de ' + to + '.');
  credApplyTo_(acts, r, to, 'Manual', motivo, me.name);
  return { ok: true, record: credClean_(r) };
}

// ─── LÍNEAS OFRECIDAS ──────────────────────────────────────────────
function credOffer_(me, p) {
  var d = {};
  try { d = JSON.parse(p.data || '{}'); } catch (e) { throw new Error('Datos inválidos.'); }
  var cuenta = credDigits_(d.Cuenta), tel = credDigits_(d.Telefono).slice(-10), nombre = String(d.Nombre || '').trim().slice(0, 80);
  if (!nombre) throw new Error('Escribe el nombre del cliente.');
  if (cuenta.length < 9 && tel.length !== 10) throw new Error('Pon el número de cuenta o el teléfono del cliente.');
  var quien = me.manager && d.Asesora && credTeam_().indexOf(d.Asesora) >= 0 ? d.Asesora : me.name;
  var t = credRead_(CRED_OF_SHEET, CRED_OF_HEADERS), hoy = credToday_(), desde = credAddDays_(hoy, -CRED_DIAS);
  // ¿Ya la tenía anotada alguien más (vigente)?
  var prev = t.rows.filter(function (o) {
    return o.Estado === 'Abierta' && String(o.Fecha).slice(0, 10) >= desde &&
      ((cuenta && credDigits_(o.Cuenta) === cuenta) || (tel && credDigits_(o.Telefono).slice(-10) === tel));
  }).sort(function (a, b) { return String(a.Fecha).localeCompare(String(b.Fecha)); })[0];
  if (prev && prev.Asesora === quien) {
    prev.Nota = String(d.Nota || prev.Nota || '').slice(0, 200); prev.Actualizado = credNow_();
    if (!prev.Cuenta && cuenta) prev.Cuenta = cuenta;
    if (!prev.Telefono && tel) prev.Telefono = tel;
    credWrite_(t, prev);
    return { ok: true, offer: credClean_(prev), updated: true };
  }
  var o = { ID: 'OF' + Utilities.formatDate(new Date(), credTz_(), 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10),
    Fecha: credNow_(), Asesora: quien, Cuenta: cuenta, Nombre: nombre, Telefono: tel, Nota: String(d.Nota || '').slice(0, 200),
    Estado: 'Abierta', VentaID: '', Actualizado: credNow_() };
  credWrite_(t, o);
  return { ok: true, offer: credClean_(o), antes: prev ? { asesora: prev.Asesora, fecha: String(prev.Fecha).slice(0, 10) } : null };
}
function credOfferClose_(me, p) {
  var t = credRead_(CRED_OF_SHEET, CRED_OF_HEADERS);
  var o = t.rows.filter(function (x) { return x.ID === String(p.id || ''); })[0];
  if (!o) throw new Error('No encontré esa anotación.');
  if (!me.manager && o.Asesora !== me.name) throw new Error('Esa anotación no es tuya.');
  o.Estado = 'Cancelada'; o.Actualizado = credNow_();
  credWrite_(t, o);
  return { ok: true };
}

// ─── CONSULTAS ─────────────────────────────────────────────────────
// Antes de guardar una línea: ¿alguien más ya tenía anotado a este cliente?
function credCheck_(me, p) {
  var fecha = String(p.fecha || credToday_()).slice(0, 10);
  var c = { id: '', cuenta: credDigits_(p.cuenta), phones: credPhones_(p.telefono), nombre: String(p.nombre || ''), fecha: fecha,
            antes: fecha === credToday_() ? credNow_() : fecha + ' 23:59' };
  var w = credFindWorker_(c, credData_());
  if (!w) return { ok: true, worker: null };
  return { ok: true, worker: w.who, mio: w.who === me.name, fuente: w.fuente, fecha: w.ts.slice(0, 10) };
}
function credList_(me) {
  var hoy = credToday_(), desde = credAddDays_(hoy, -CRED_DIAS), desdeCh = credAddDays_(hoy, -90);
  var offers = credRead_(CRED_OF_SHEET, CRED_OF_HEADERS).rows.filter(function (o) {
    return String(o.Fecha).slice(0, 10) >= desde && (me.manager || o.Asesora === me.name);
  }).map(function (o) {
    var c = credClean_(o);
    c.Vence = credAddDays_(String(o.Fecha).slice(0, 10), CRED_DIAS);
    return c;
  });
  var cambios = credRead_(CRED_CH_SHEET, CRED_CH_HEADERS).rows.filter(function (x) {
    return String(x.Fecha).slice(0, 10) >= desdeCh && (me.manager || x.De === me.name || x.A === me.name || x.Activo === me.name);
  }).map(credClean_);
  return { ok: true, today: hoy, dias: CRED_DIAS, desde: CRED_DESDE, equipo: credTeam_(), ofrecidas: offers, cambios: cambios };
}
