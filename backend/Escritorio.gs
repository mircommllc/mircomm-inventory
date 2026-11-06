/**
 * Escritorio.gs — "Mi Escritorio" de Joel en el MirComm Store Hub
 * -----------------------------------------------------------------------------
 * Pendientes, "Esperando respuesta", notas, bitácora y la Bandeja de pendientes (compartidos entre los
 * administradores; cada pendiente guarda quién lo creó, quién lo terminó y de quién es cada prioridad del día)
 * que el Hub crea solo (comisiones sin pago, día de pago de Cellmart, stock bajo,
 * seguimientos atrasados de las asesoras). Solo el manager puede usarlo.
 * También recibe las acciones del asistente Claude (ver Asistente.gs).
 *
 * Usa: authSession_ (Activaciones.gs), SPREADSHEET_ID (Code.gs).
 *
 * INSTALAR (una sola vez):
 *  1. Apps Script: ＋ → Script → nómbralo "Escritorio" → pega todo este archivo → Guardar.
 *  2. Apps Script: ＋ → Script → nómbralo "Asistente" → pega Asistente.gs → Guardar.
 *  3. En Code.gs, dentro de doPost(e), pega esta línea como PRIMERA línea,
 *     justo debajo de  function doPost(e) {
 *        var es = escritorioRouter_(e); if (es) return es;
 *  4. Selecciona probarCorreo → Run (acepta los permisos de Gmail; no manda nada).
 *  5. Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *  Las hojas Esc_Pendientes, Esc_Notas y Esc_Contactos se crean solas la primera vez.
 *  ACTUALIZAR: reemplaza todo el archivo, Guardar, probarCorreo → Run, y Deploy → New version.
 */

var ESC_TASKS = 'Esc_Pendientes';
var ESC_NOTES = 'Esc_Notas';
var ESC_TASK_HEADERS = ['ID', 'Tipo', 'Titulo', 'Notas', 'Categoria', 'Prioridad', 'Fecha', 'Hora', 'Monto',
  'LigaTipo', 'LigaValor', 'Asignado', 'Estado', 'Top3', 'EsperaDe', 'EnviadoEl', 'Repetir', 'Origen',
  'AutoKey', 'NotaID', 'Creado', 'Actualizado', 'HechoEl', 'GmailThread', 'CreadoPor', 'HechoPor', 'Top3Por', 'RespVisto', 'EventoCal', 'EventoSig'];
var ESC_NOTE_HEADERS = ['ID', 'Titulo', 'Texto', 'Fijada', 'LigaTipo', 'LigaValor', 'Creado', 'Actualizado'];
var ESC_CONTACTS = 'Esc_Contactos';
var ESC_CONTACT_HEADERS = ['ID', 'Nombre', 'Correo', 'Empresa', 'Idioma', 'Uso', 'Telefono'];
// Se crean la primera vez. Cellmart siempre en inglés, salvo Maria (inglés o español).
var ESC_CONTACT_SEED = [
  ['C1', 'Comisiones Cellmart', 'commissions@cellmart.us', 'Cellmart', 'en', 'Disputas y reclamos de comisión', ''],
  ['C2', 'Maria', 'maria@cellmart.us', 'Cellmart', 'en/es', 'Asuntos generales con Cellmart', ''],
  ['C3', 'Kasey', 'kasey@cellmart.us', 'Cellmart', 'en', 'Comisiones (seguimiento)', ''],
  ['C4', 'Karen', 'karen@cellmart.us', 'Cellmart', 'en', 'Cumplimiento y marketing', ''],
  ['C5', 'Krystal', 'krystal@cellmart.us', 'Cellmart', 'en', 'Auditorías', ''],
  ['C6', 'Anika Duong', 'anika@cellmart.us', 'Cellmart', 'en', 'Teléfonos defectuosos, RMA y créditos', '']
];
var ESC_SIGNATURE = 'Joel Chavez\nOwner / General Manager\nMirComm LLC · Spectrum Rep ID CMMCL4423\n956-603-6505';
var ESC_CATS = ['Cellmart', 'Tienda', 'Prospecto', 'Empleados', 'Proveedores', 'Personal', 'Hub'];
var ESC_PAYDAY_ANCHOR = '2026-10-12';   // un lunes de pago de Cellmart; pagan cada 14 días
var ESC_PAY_LAG_DAYS = 28;              // una conexión entra en el pago que cae 4+ semanas después

// ─── Router (POST) ─────────────────────────────────────────────────
function escritorioRouter_(e) {
  var body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents) || {}; } catch (err) { return null; }
  }
  var a = String(body.action || '');
  if (a.indexOf('esc') !== 0 && a.indexOf('ai') !== 0) return null;
  var out;
  if (a === 'escRepGet') {   // la asesora (usuario + PIN de 6 dígitos) ve su meta de la semana en el recuadro al entrar
    try { out = escRepGet_(body); } catch (err) { out = { error: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }
  try {
    var ses = typeof authSession_ === 'function' ? authSession_(body.mt) : null;
    if (!ses) out = { error: 'Tu sesión venció. Entra otra vez con tu PIN.', code: 'AUTH' };
    else if (!ses.manager) out = { error: 'Mi Escritorio es solo para el manager.', code: 'AUTH' };
    else {
      switch (a) {
        case 'escLoad':       out = escLoad_(); break;
        case 'escSave':       out = escLocked_(function () { return escSave_(body.item || {}, body.origen); }); break;
        case 'escDone':       out = escLocked_(function () { return escDone_(String(body.id || ''), body.done !== false); }); break;
        case 'escDelete':     out = escLocked_(function () { return escDelete_(ESC_TASKS, String(body.id || '')); }); break;
        case 'escTop3':       out = escLocked_(function () { return escTop3_(body.ids || [], body.fecha); }); break;
        case 'escMove':       out = escLocked_(function () { return escMove_(body.ids || [], body.fecha); }); break;
        case 'escInbox':      out = escLocked_(function () { return escInboxAct_(body); }); break;
        case 'escNoteSave':   out = escLocked_(function () { return escNoteSave_(body.note || {}); }); break;
        case 'escNoteDelete': out = escLocked_(function () { return escDelete_(ESC_NOTES, String(body.id || '')); }); break;
        case 'aiStatus':      out = aiStatus_(); break;
        case 'aiAsk':         out = aiAsk_(body); break;
        case 'aiParse':       out = aiParse_(body); break;
        case 'aiLimit':       out = aiSetLimit_(body.limite); break;
        case 'aiDraft':       out = aiDraft_(body); break;
        case 'escSend':       out = escLocked_(function () { return escSend_(body); }); break;
        case 'escContactSave':   out = escLocked_(function () { return escContactSave_(body.contact || {}); }); break;
        case 'escContactDelete': out = escLocked_(function () { return escDelete_(ESC_CONTACTS, String(body.id || '')); }); break;
        case 'escDispRows':   out = escDispRows_(body); break;
        case 'escDispFile':   out = escDispFile_(body); break;
        case 'escWaitAck':    out = escLocked_(function () { return escWaitAck_(body); }); break;
        case 'escMetasSave':  out = escLocked_(function () { return escMetasSave_(body); }); break;
        default: out = { error: 'Acción desconocida: ' + a };
      }
    }
  } catch (err) {
    out = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function escLocked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ─── Utilidades de hoja ────────────────────────────────────────────
function escSS_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function escTz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }
function escFmt_(d, f) { return Utilities.formatDate(d, escTz_(), f || 'yyyy-MM-dd HH:mm'); }
function escToday_() { return escFmt_(new Date(), 'yyyy-MM-dd'); }
function escAddDays_(ymd, n) {
  var p = String(ymd).split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2] + n, 12);
  return escFmt_(d, 'yyyy-MM-dd');
}
function escDaysBetween_(a, b) {   // b - a en días (yyyy-MM-dd)
  var pa = String(a).split('-').map(Number), pb = String(b).split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function escId_(p) { return p + escFmt_(new Date(), 'yyMMddHHmmss') + Math.floor(Math.random() * 900 + 100); }

function escSheet_(name, headers) {
  var ss = escSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold')
      .setBackground('#0A1F3C').setFontColor('#FFFFFF');
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  } else {
    var lastCol = sh.getLastColumn();
    var have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var miss = headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (miss.length) {
      sh.getRange(1, have.length + 1, 1, miss.length).setValues([miss]).setFontWeight('bold')
        .setBackground('#0A1F3C').setFontColor('#FFFFFF');
      sh.getRange(1, have.length + 1, sh.getMaxRows(), miss.length).setNumberFormat('@');
    }
  }
  return sh;
}
function escRead_(name, headers) {
  var sh = escSheet_(name, headers);
  var v = sh.getDataRange().getValues();
  var H = v[0].map(String);
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i].join('')) continue;
    var o = { _row: i + 1 };
    H.forEach(function (h, j) {
      var x = v[i][j];
      o[h] = x instanceof Date ? escFmt_(x, h === 'Fecha' || h === 'Top3' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm') : (x === null ? '' : String(x));
    });
    rows.push(o);
  }
  return { sh: sh, headers: H, rows: rows };
}
function escWrite_(sh, headers, o) {
  if (sh.getName() === ESC_TASKS) escCalSync_(o);   // pendientes con hora → Google Calendar
  var row = headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); });
  if (o._row) sh.getRange(o._row, 1, 1, headers.length).setNumberFormat('@').setValues([row]);
  else { sh.appendRow(row); o._row = sh.getLastRow(); }
}
function escClean_(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; }); return c; }
function escRowsOf_(name) {   // filas de cualquier hoja como objetos (para Activations, Customers, etc.)
  var sh = escSS_().getSheetByName(name);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  var H = v[0].map(String);
  return v.slice(1).filter(function (r) { return r.join(''); }).map(function (r) {
    var o = {};
    H.forEach(function (h, j) { var x = r[j]; o[h] = x instanceof Date ? escFmt_(x, 'yyyy-MM-dd HH:mm') : x; });
    return o;
  });
}

// ─── Cargar todo ───────────────────────────────────────────────────
function escLoad_() {
  var today = escToday_();
  var td = escRead_(ESC_TASKS, ESC_TASK_HEADERS), t = td.rows;
  var cutoff = escAddDays_(today, -90);
  var items = t.filter(function (r) {
    if (r.Estado === 'Descartado') return false;
    if (r.Estado === 'Hecho') return String(r.HechoEl).slice(0, 10) >= cutoff;
    return true;
  }).map(escClean_);
  var waitError = '';
  try { escWaitCheck_(td, items); } catch (err) { waitError = err.message; }   // Fase 2: ¿ya contestaron?
  var notes = escRead_(ESC_NOTES, ESC_NOTE_HEADERS).rows.map(escClean_);
  var inbox = [], inboxError = '';
  try { inbox = escInbox_(t, today); } catch (err) { inboxError = err.message; }
  var agenda = [];
  try { agenda = escAgenda_(today); } catch (err) {}
  var ai = { configured: false };
  try { ai = aiStatus_(); } catch (err) {}
  var contacts = [];
  try { contacts = escContactsRead_().rows.map(escClean_); } catch (err) {}
  return { ok: true, today: today, now: escFmt_(new Date(), 'yyyy-MM-dd HH:mm'), items: items, notes: notes,
    metas: escMetasRead_(), segPor: escSegPor_(today), inbox: inbox, inboxError: inboxError, waitError: waitError, agenda: agenda, ai: ai, cats: ESC_CATS, contacts: contacts };
}

// ─── Pendientes ────────────────────────────────────────────────────
function escSave_(it, origen) {
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  var now = escFmt_(new Date());
  var r = null;
  if (it.ID) r = d.rows.filter(function (x) { return x.ID === it.ID; })[0];
  if (it.ID && !r) throw new Error('No encontré ese pendiente.');
  if (!r) r = { ID: escId_('T'), Estado: 'Abierto', Creado: now, Origen: String(origen || it.Origen || 'manual'), Asignado: escWho_(), CreadoPor: escWho_() };
  var fields = ['Tipo', 'Titulo', 'Notas', 'Categoria', 'Prioridad', 'Fecha', 'Hora', 'Monto', 'LigaTipo', 'LigaValor',
    'Asignado', 'EsperaDe', 'EnviadoEl', 'Repetir', 'AutoKey', 'NotaID', 'GmailThread'];
  fields.forEach(function (f) { if (it[f] !== undefined) r[f] = String(it[f] === null ? '' : it[f]).trim(); });
  if (!r.Titulo) throw new Error('Falta el título del pendiente.');
  r.Tipo = r.Tipo === 'Espera' ? 'Espera' : 'Tarea';
  if (r.Tipo === 'Espera' && !r.EnviadoEl) r.EnviadoEl = escToday_();
  if (r.Fecha && !/^\d{4}-\d{2}-\d{2}$/.test(r.Fecha)) throw new Error('La fecha debe ser AAAA-MM-DD.');
  if (r.Monto) r.Monto = String(Number(String(r.Monto).replace(/[$,\s]/g, '')) || '');
  if (['Alta', 'Normal', 'Baja'].indexOf(r.Prioridad) < 0) r.Prioridad = 'Normal';
  r.Actualizado = now;
  escWrite_(d.sh, d.headers, r);
  return { ok: true, item: escClean_(r) };
}

function escDone_(id, done) {
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  var r = d.rows.filter(function (x) { return x.ID === id; })[0];
  if (!r) throw new Error('No encontré ese pendiente.');
  var now = escFmt_(new Date());
  var next = null;
  if (done && r.Estado !== 'Hecho') {
    r.Estado = 'Hecho'; r.HechoEl = now; r.HechoPor = escWho_();
    var step = { semanal: 7, quincenal: 14 }[r.Repetir];
    if (step || r.Repetir === 'mensual') {
      var base = r.Fecha || escToday_();
      var nf = step ? escAddDays_(base, step) : (function () {
        var p = base.split('-').map(Number); return escFmt_(new Date(p[0], p[1], p[2], 12), 'yyyy-MM-dd');
      })();
      next = escClean_(r);
      delete next.ID;
      next.Estado = 'Abierto'; next.HechoEl = ''; next.HechoPor = ''; next.Top3 = ''; next.Top3Por = ''; next.Fecha = nf; next.AutoKey = '';
      next.ID = escId_('T'); next.Creado = now; next.Origen = 'repetir';
      escWrite_(d.sh, d.headers, next);
      next = escClean_(next);
    }
  } else if (!done) {
    r.Estado = 'Abierto'; r.HechoEl = ''; r.HechoPor = '';
  }
  r.Actualizado = now;
  escWrite_(d.sh, d.headers, r);
  return { ok: true, item: escClean_(r), next: next };
}

function escDelete_(sheet, id) {
  var d = sheet === ESC_NOTES ? escRead_(ESC_NOTES, ESC_NOTE_HEADERS) : sheet === ESC_CONTACTS ? escContactsRead_() : escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  var r = d.rows.filter(function (x) { return x.ID === id; })[0];
  if (!r) throw new Error('No lo encontré.');
  if (sheet === ESC_TASKS && r.EventoCal) escCalDelete_(r.EventoCal);
  d.sh.deleteRow(r._row);
  return { ok: true };
}

function escTop3_(ids, fecha) {
  fecha = fecha || escToday_();
  if (ids.length > 3) throw new Error('Escoge máximo 3 prioridades.');
  var me = escWho_();
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  d.rows.forEach(function (r) {
    var want = ids.indexOf(r.ID) >= 0;
    var mine = (r.Top3Por || 'Joel') === me;          // las de antes (sin nombre) son de Joel
    if (!want && r.Top3 === fecha && !mine) return;     // prioridad de otra persona: no se toca
    var has = r.Top3 === fecha && mine;
    if (want !== has) {
      r.Top3 = want ? fecha : '';
      r.Top3Por = want ? me : '';
      if (want && (!r.Fecha || r.Fecha > fecha)) r.Fecha = fecha;
      r.Actualizado = escFmt_(new Date());
      escWrite_(d.sh, d.headers, r);
    }
  });
  return { ok: true };
}

function escMove_(ids, fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw new Error('Fecha no válida.');
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  var n = 0;
  d.rows.forEach(function (r) {
    if (ids.indexOf(r.ID) < 0) return;
    r.Fecha = fecha; r.Top3 = ''; r.Actualizado = escFmt_(new Date());
    escWrite_(d.sh, d.headers, r); n++;
  });
  return { ok: true, moved: n };
}

// ─── Notas ─────────────────────────────────────────────────────────
function escNoteSave_(n) {
  var d = escRead_(ESC_NOTES, ESC_NOTE_HEADERS);
  var now = escFmt_(new Date());
  var r = null;
  if (n.ID) r = d.rows.filter(function (x) { return x.ID === n.ID; })[0];
  if (n.ID && !r) throw new Error('No encontré esa nota.');
  if (!r) r = { ID: escId_('N'), Creado: now };
  ['Titulo', 'Texto', 'Fijada', 'LigaTipo', 'LigaValor'].forEach(function (f) { if (n[f] !== undefined) r[f] = String(n[f] === null ? '' : n[f]); });
  if (!String(r.Titulo || '').trim() && !String(r.Texto || '').trim()) throw new Error('La nota está vacía.');
  if (!String(r.Titulo || '').trim()) r.Titulo = String(r.Texto).trim().split('\n')[0].slice(0, 60);
  r.Fijada = r.Fijada === 'true' || r.Fijada === 'Sí' ? 'Sí' : '';
  r.Actualizado = now;
  escWrite_(d.sh, d.headers, r);
  return { ok: true, note: escClean_(r) };
}

// ─── Bandeja: lo que el Hub detecta solo ───────────────────────────
function escInboxAct_(b) {
  var key = String(b.key || '');
  if (!key) throw new Error('Falta la clave del aviso.');
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  if (d.rows.some(function (r) { return r.AutoKey === key; })) return { ok: true, dup: true };
  if (b.accion === 'descartar') {
    var now = escFmt_(new Date());
    var r = { ID: escId_('T'), Tipo: 'Tarea', Titulo: String(b.titulo || key), Estado: 'Descartado', AutoKey: key,
      Origen: 'bandeja', Creado: now, Actualizado: now };
    escWrite_(d.sh, d.headers, r);
    return { ok: true };
  }
  var it = b.item || {};
  it.AutoKey = key;
  return escSave_(it, 'bandeja');
}

function escInbox_(tasks, today) {
  var used = {};
  tasks.forEach(function (r) { if (r.AutoKey) used[r.AutoKey] = 1; });
  var out = [];
  // Hilos de "Esperando respuesta" abiertos: su respuesta sale en esa tarjeta, no en la Bandeja
  var waitTh = {};
  tasks.forEach(function (r) { if (r.Tipo === 'Espera' && r.Estado === 'Abierto' && r.GmailThread) waitTh[String(r.GmailThread)] = 1; });
  var add = function (x) { if (!used[x.key] && !((x.tipo === 'correo' || x.tipo === 'alloc') && x.thread && waitTh[x.thread])) out.push(x); };

  // 1) Comisiones de internet sin pago (Core vs. historial de Commission Reports)
  var unpaid = escUnpaidInternet_();
  // Regla de Cellmart: disputar dentro de 7 días naturales después de recibir el Commission Report
  var plazo = unpaid.ultimoPagoYmd ? escAddDays_(unpaid.ultimoPagoYmd, 7) : '';
  var plazoTxt = plazo && plazo >= today ? ' · ⏰ disputar a más tardar el ' + escNice_(plazo) + ' (7 días después del pago)' : '';
  unpaid.list.forEach(function (u) {
    add({ key: 'com:' + u.cuenta + ':int', tipo: 'comision', titulo: 'Reclamar comisión de internet: ' + u.nombre,
      detalle: 'Cuenta ' + u.cuenta + ' · conectó ' + u.conecto + ' · ' + (u.tier || 'Internet') + ' · no aparece en ningún pago hasta el ' + unpaid.ultimoPago + plazoTxt,
      item: { Titulo: 'Reclamar comisión de internet: ' + u.nombre, Categoria: 'Cellmart', Prioridad: 'Alta',
        Fecha: plazo && plazo >= today ? plazo : today, Monto: u.monto || '', LigaTipo: 'cuenta', LigaValor: u.cuenta,
        Notas: 'Conectó ' + u.conecto + ' (' + (u.tier || 'Internet') + '). No aparece en los Commission Reports hasta el pago del ' + unpaid.ultimoPago + '. Mandar a commissions@cellmart.us con el formato de disputa.' +
          (plazoTxt ? ' Plazo de Cellmart: ' + escNice_(plazo) + '.' : '') } });
  });

  // 2) Día de pago de Cellmart → subir el Commission Report
  var pd = escLastPayday_(today);
  if (escDaysBetween_(pd, today) <= 6 && (!unpaid.ultimoPagoYmd || unpaid.ultimoPagoYmd < pd)) {
    add({ key: 'pay:' + pd, tipo: 'pago', titulo: 'Subir el Commission Report del pago del ' + escNice_(pd),
      detalle: 'Cellmart pagó el ' + escNice_(pd) + '. Súbelo en Activaciones para revisar qué se pagó y qué falta.',
      item: { Titulo: 'Subir el Commission Report del pago del ' + escNice_(pd), Categoria: 'Cellmart', Prioridad: 'Alta', Fecha: today } });
  }

  // 3) Stock bajo / agotado (accesorios) y SIM cards por compañía
  try {
    var stock = escRowsOf_('Stock_Palmhurst');
    var acc = stock.filter(function (s) { return !/phone|sim/i.test(String(s.Category || '')); });
    var low = acc.filter(function (s) { var q = Number(s.Quantity); return s.Quantity !== '' && q <= (Number(s.MinQty) || 0); });
    if (low.length) {
      var names = low.slice(0, 4).map(function (s) { return s.Name + ' (' + (Number(s.Quantity) || 0) + ')'; }).join(', ');
      var wk = escFmt_(new Date(), "yyyy-'W'ww");
      add({ key: 'stock:' + wk + ':' + low.length, tipo: 'stock', titulo: 'Stock bajo: ' + low.length + ' producto' + (low.length > 1 ? 's' : ''),
        detalle: names + (low.length > 4 ? '…' : ''),
        item: { Titulo: 'Pedir accesorios con stock bajo (' + low.length + ')', Categoria: 'Tienda', Fecha: escAddDays_(today, 1), Notas: low.map(function (s) { return s.Name + ': ' + (Number(s.Quantity) || 0); }).join('\n') } });
    }
    var sims = {};
    stock.filter(function (s) { return /sim/i.test(String(s.Category || '')); }).forEach(function (s) {
      var c = String(s.Carrier || 'Otra'); sims[c] = (sims[c] || 0) + (Number(s.Quantity) > 0 ? Number(s.Quantity) : 0);
    });
    Object.keys(sims).forEach(function (c) {
      if (/spectrum|at&t|att/i.test(c) && sims[c] < 3) {
        add({ key: 'sim:' + c + ':' + escFmt_(new Date(), "yyyy-'W'ww"), tipo: 'stock', titulo: 'Quedan ' + sims[c] + ' SIM cards de ' + c,
          detalle: 'Pídele más a Cellmart antes de quedarte sin.',
          item: { Titulo: 'Pedir SIM cards de ' + c + ' a Cellmart', Categoria: 'Tienda', Prioridad: sims[c] ? 'Normal' : 'Alta', Fecha: today } });
      }
    });
  } catch (err) {}

  // 4) Cellmart avisa que tienes teléfonos "allocated" y no has contestado
  try {
    var me = escMe_();
    GmailApp.search('from:cellmart.us (allocated OR allocation) newer_than:21d', 0, 10).forEach(function (th) {
      var msgs = th.getMessages(), last = msgs[msgs.length - 1];
      if (me && String(last.getFrom()).toLowerCase().indexOf(me) >= 0) return;   // ya contestaste
      // Solo si de verdad habla de teléfonos asignados (Gmail a veces encuentra "allocation" en otros correos, como pagos o spiffs)
      if (!/allocat/i.test(th.getFirstMessageSubject() + ' ' + String(last.getPlainBody() || '').slice(0, 1500)) ||
          /commission applied|spiff|payment receipt/i.test(th.getFirstMessageSubject())) return;
      var from = String(last.getFrom()).replace(/<.*>/, '').replace(/"/g, '').trim();
      var txt = String(last.getPlainBody() || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      var de = (String(last.getFrom()).match(/<([^>]+)>/) || [0, String(last.getFrom())])[1].trim();
      add({ key: 'alloc:' + th.getId(), tipo: 'alloc', thread: th.getId(), de: de, titulo: 'Cellmart te asignó teléfonos: contestar',
        detalle: (from ? from + ' · ' : '') + th.getFirstMessageSubject() + ' — ' + txt,
        item: { Titulo: 'Contestar a Cellmart: teléfonos asignados (' + th.getFirstMessageSubject() + ')', Categoria: 'Cellmart', Prioridad: 'Alta',
          Fecha: today, GmailThread: th.getId(), Notas: txt } });
    });
  } catch (err) {}

  // 4b) Cualquier correo de Cellmart dirigido a ti que no has contestado (Anika, Maria, Kasey, Krystal…)
  try {
    var me2 = escMe_(), allocTh = {};
    out.forEach(function (x) { if (x.thread) allocTh[x.thread] = 1; });
    GmailApp.search('from:cellmart.us newer_than:14d -from:marketing@cellmart.us -in:sent', 0, 20).forEach(function (th) {
      if (allocTh[th.getId()]) return;
      var msgs = th.getMessages(), last = msgs[msgs.length - 1];
      var lf = String(last.getFrom()).toLowerCase();
      if (lf.indexOf(me2) >= 0 || !/@cellmart\.us/.test(lf) || /marketing@|no-?reply|commissions@/.test(lf)) return;
      var dest = (String(last.getTo() || '') + ',' + String(last.getCc() || '')).toLowerCase();
      if (dest.indexOf(me2) < 0) return;   // los avisos a todos los dealers no
      var from = String(last.getFrom()).replace(/<.*>/, '').replace(/"/g, '').trim();
      var de = (String(last.getFrom()).match(/<([^>]+)>/) || [0, String(last.getFrom())])[1].trim();
      var subj = th.getFirstMessageSubject();
      var txt = String(last.getPlainBody() || '').split(/\n_{8,}|\nFrom: |\nOn .{5,80} wrote:|\nEl .{5,80} escribió:/)[0]
        .replace(/\s+/g, ' ').trim().slice(0, 240);
      var who = from.split(' ')[0] || de;
      add({ key: 'mail:' + th.getId() + ':' + last.getId(), tipo: 'correo', thread: th.getId(), de: de,
        esperaTitulo: 'Respuesta a ' + who + ': ' + subj,
        titulo: 'Contestar a ' + who + ' (Cellmart): ' + subj, detalle: (from ? from + ' · ' : '') + txt,
        item: { Titulo: 'Contestar a ' + who + ' (Cellmart): ' + subj, Categoria: 'Cellmart', Prioridad: 'Normal',
          Fecha: today, GmailThread: th.getId(), Notas: txt } });
    });
  } catch (err) {}

  // 4c) 🤝 Lo que prometiste en tus correos ("we will ship the phone by the end of the week")
  try { escPromInbox_(tasks, today, add); } catch (err) {}

  // 5) Seguimientos de prospectos atrasados por asesora
  try {
    var seg = escRowsOf_('Seg_Tareas').filter(function (s) {
      var f = String(s.Fecha || '').slice(0, 10);
      return s.Estado === 'Pendiente' && f && f < today;
    });
    var by = {};
    seg.forEach(function (s) { var a = String(s.Asesora || '—'); by[a] = (by[a] || 0) + 1; });
    Object.keys(by).forEach(function (a) {
      add({ key: 'seg:' + a + ':' + today, tipo: 'seguimiento', titulo: a + ' tiene ' + by[a] + ' seguimiento' + (by[a] > 1 ? 's' : '') + ' atrasado' + (by[a] > 1 ? 's' : ''),
        detalle: 'Prospectos que ya debían contactarse. Revísalo con ' + a + '.',
        item: { Titulo: 'Revisar con ' + a + ' sus ' + by[a] + ' seguimientos atrasados', Categoria: 'Empleados', Fecha: today, Asignado: escWho_() } });
    });
  } catch (err) {}
  return out;
}

function escNice_(ymd) {
  var m = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var p = String(ymd).split('-');
  return Number(p[2]) + ' ' + m[Number(p[1]) - 1];
}
function escLastPayday_(today) {
  var diff = escDaysBetween_(ESC_PAYDAY_ANCHOR, today);
  var k = Math.floor(diff / 14);
  return escAddDays_(ESC_PAYDAY_ANCHOR, k * 14);
}
function escMdy_(s) {   // "08/28/2026" → "2026-08-28"
  var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
}
function escDigits_(s) { return String(s || '').replace(/\D/g, ''); }

/** Reporte guardado de Cellmart (Reportes.gs) como lista de objetos. tipo: core | mobile | commission */
function escReport_(tipo) {
  var sh = escSS_().getSheetByName('Reportes_Cellmart');
  if (!sh || sh.getLastRow() < 2) return { rows: [], archivo: '', guardado: '' };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().filter(function (r) { return r[0] === tipo; });
  if (!v.length) return { rows: [], archivo: '', guardado: '' };
  v.sort(function (a, b) { return Number(a[1]) - Number(b[1]); });
  var json = v.map(function (r) { return String(r[4]).slice(1); }).join('');
  var grid = JSON.parse(json);
  var H = (grid[0] || []).map(function (h) { return String(h).trim(); });
  var rows = grid.slice(1).map(function (r) { var o = {}; H.forEach(function (h, i) { o[h] = r[i]; }); return o; });
  return { rows: rows, archivo: v[0][2], guardado: v[0][3] instanceof Date ? escFmt_(v[0][3]) : String(v[0][3]) };
}

/** Conexiones de internet del Core Report que ya debieron pagarse y no aparecen pagadas. */
function escUnpaidInternet_() {
  var core = escReport_('core').rows, com = escReport_('commission').rows;
  var paid = {}, lastPay = '';
  com.forEach(function (c) {
    var pdte = escMdy_(c['Payment Date']);
    if (pdte && pdte > lastPay) lastPay = pdte;
    var amt = Number(String(c['Commission Paid'] || '').replace(/[$,\s]/g, '')) || 0;
    var acct = escDigits_(c['Account No.']);
    var bundle = String(c['Bundle Name'] || '');
    var isInt = Number(c['Internet PSU']) > 0 || /internet/i.test(bundle);
    if (acct && isInt && amt > 0 && String(c.Direction || 'Add') !== 'Remove') paid[acct] = true;
  });
  var list = [], seen = {};
  if (lastPay) core.forEach(function (k) {
    if (String(k.PSU) !== 'Internet' || String(k['Sales - Connects']) !== '1') return;
    var acct = escDigits_(k['Customer - Account Number']);
    if (!acct || seen[acct] || paid[acct]) return;
    var conn = escMdy_(k['Date - Connect']);
    if (!conn || escAddDays_(conn, ESC_PAY_LAG_DAYS) > lastPay) return;   // todavía no le toca
    if (escDaysBetween_(conn, lastPay) > 200) return;
    seen[acct] = 1;
    var tier = String(k['InternetTier - Time of Connect'] || k['InternetTier - Time of Sale'] || '');
    var monto = /gig/i.test(tier) ? 500 : /500/.test(tier) ? 380 : /100|300/.test(tier) ? 320 : '';
    var nm = String(k['Customer Full Name'] || '').split(',');
    var nombre = nm.length > 1 ? (nm[1] + ' ' + nm[0]).trim() : nm[0];
    nombre = nombre.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    list.push({ cuenta: acct, nombre: nombre, conecto: conn, tier: tier, monto: monto, rep: k.Agent || '' });
  });
  return { list: list, ultimoPago: lastPay ? escNice_(lastPay) : '', ultimoPagoYmd: lastPay };
}

// ─── Agenda de hoy: seguimientos de prospectos con fecha de hoy ───
function escAgenda_(today) {
  var names = {};
  try { escRowsOf_('Prospectos').forEach(function (p) { names[p.ID] = p.Nombre; }); } catch (e) {}
  return escRowsOf_('Seg_Tareas').filter(function (s) {
    return s.Estado === 'Pendiente' && String(s.Fecha || '').slice(0, 10) === today;
  }).map(function (s) {
    var hm = String(s.Hora || '').match(/(\d{1,2}:\d{2})/);
    var h = hm ? ('0' + hm[1]).slice(-5) : '';
    return { tipo: 'seguimiento', hora: h, titulo: (s.Tipo || 'Seguimiento') + ': ' + (names[s.ProspectoID] || 'prospecto'),
      detalle: (s.Asesora || '') + (s.Nota ? ' · ' + s.Nota : '') };
  });
}


// ─── Contactos ─────────────────────────────────────────────────────
function escContactsRead_() {
  var fresh = !escSS_().getSheetByName(ESC_CONTACTS);
  var d = escRead_(ESC_CONTACTS, ESC_CONTACT_HEADERS);
  if (fresh && !d.rows.length) {
    ESC_CONTACT_SEED.forEach(function (r) { d.sh.appendRow(r); });
    d = escRead_(ESC_CONTACTS, ESC_CONTACT_HEADERS);
  }
  // Contactos nuevos que se agregan una sola vez (si los borras, no vuelven)
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ESC_SEED_ANIKA')) {
    if (!d.rows.some(function (r) { return /^anika@cellmart\.us$/i.test(String(r.Correo || '')); })) {
      escWrite_(d.sh, d.headers, { ID: escId_('C'), Nombre: 'Anika Duong', Correo: 'anika@cellmart.us', Empresa: 'Cellmart', Idioma: 'en',
        Uso: 'Teléfonos defectuosos, RMA y créditos', Telefono: '' });
      d = escRead_(ESC_CONTACTS, ESC_CONTACT_HEADERS);
    }
    props.setProperty('ESC_SEED_ANIKA', '1');
  }
  return d;
}
function escContactSave_(c) {
  var d = escContactsRead_();
  var r = c.ID ? d.rows.filter(function (x) { return x.ID === c.ID; })[0] : null;
  if (c.ID && !r) throw new Error('No encontré ese contacto.');
  if (!r) r = { ID: escId_('C') };
  ['Nombre', 'Correo', 'Empresa', 'Idioma', 'Uso', 'Telefono'].forEach(function (f) { if (c[f] !== undefined) r[f] = String(c[f] || '').trim(); });
  if (!r.Nombre) throw new Error('Falta el nombre.');
  if (r.Correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.Correo)) throw new Error('El correo no es válido.');
  if (/@cellmart\.us$/i.test(r.Correo) && !/^maria@/i.test(r.Correo)) r.Idioma = 'en';   // regla: Cellmart en inglés
  if (['en', 'es', 'en/es'].indexOf(r.Idioma) < 0) r.Idioma = 'en/es';
  escWrite_(d.sh, d.headers, r);
  return { ok: true, contact: escClean_(r) };
}
/** Idioma obligatorio para un correo: Cellmart siempre inglés (menos Maria). */
function escLangFor_(email, pedido) {
  email = String(email || '').toLowerCase();
  if (/@cellmart\.us\b/.test(email) && !/^maria@cellmart\.us$/.test(email.trim())) return 'en';
  return pedido === 'es' ? 'es' : 'en';
}
function escAddBizDays_(ymd, n) {
  var d = ymd;
  while (n > 0) { d = escAddDays_(d, 1); var p = d.split('-').map(Number); var w = new Date(p[0], p[1] - 1, p[2], 12).getDay(); if (w !== 0 && w !== 6) n--; }
  return d;
}

// ─── Mandar correo desde Gmail (mircommllc@gmail.com) ─────────────
/** body: { to, cc, subject, text, threadId, draftOnly, kind, itemIds:[], espera:{ quien, titulo, monto, ligaTipo, ligaValor, categoria } } */
function escSend_(b) {
  var to = String(b.to || '').trim(), cc = String(b.cc || '').trim();
  var mail = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
  if (!to.split(/[,;]\s*/).every(function (x) { return mail.test(x); })) throw new Error('Revisa el correo de "Para".');
  if (cc && !cc.split(/[,;]\s*/).every(function (x) { return mail.test(x); })) throw new Error('Revisa el correo de "CC".');
  var subject = String(b.subject || '').trim(), text = String(b.text || '').trim();
  if (!subject || !text) throw new Error('Falta el asunto o el texto del correo.');
  var opts = { name: escFromName_() };
  if (cc) opts.cc = cc;
  var adjuntos = [];
  if (b.disputa && (b.disputa.rows || []).length) {   // formato oficial de Cellmart (Disputas.gs)
    adjuntos = dispFiles_(b.disputa.rows, b.disputa.fecha);
    opts.attachments = adjuntos.map(function (f) { return f.blob; });
  }
  var me = escMe_();
  var draft = null;
  if (b.threadId) {
    var th = null;
    try { th = GmailApp.getThreadById(String(b.threadId)); } catch (e) {}
    if (th) {
      var msgs = th.getMessages(), other = null;
      for (var i = msgs.length - 1; i >= 0; i--) { if (String(msgs[i].getFrom()).toLowerCase().indexOf(me) < 0) { other = msgs[i]; break; } }
      if (other && b.replyAll) {   // responder a todos, sin copiarte a ti mismo
        var sender = (String(other.getFrom()).match(/[^<\s,;]+@[^>\s,;]+/) || [''])[0].toLowerCase();
        var all = (String(other.getTo() || '') + ',' + String(other.getCc() || '') + ',' + cc).match(/[^<\s,;"]+@[^>\s,;"]+/g) || [];
        var seen = {}, list = [];
        all.forEach(function (e) { var k = e.toLowerCase(); if (k !== me && k !== sender && !seen[k]) { seen[k] = 1; list.push(e); } });
        if (list.length) opts.cc = list.join(', '); else delete opts.cc;
        draft = other.createDraftReply(text, opts);
      } else if (other) draft = other.createDraftReply(text, opts);
      else { subject = /^re:/i.test(subject) ? subject : 'Re: ' + th.getFirstMessageSubject(); }
    }
  }
  if (!draft) draft = GmailApp.createDraft(to, subject, text, opts);
  if (b.draftOnly) {
    return { ok: true, draft: true, threadId: draft.getMessage().getThread().getId() };
  }
  var msg = draft.send();
  var threadId = msg.getThread().getId();
  var today = escToday_(), now = escFmt_(new Date());
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  var ids = b.itemIds || [], touched = [], created = null, first = null;
  var log = '✉ ' + escFmt_(new Date(), 'yyyy-MM-dd HH:mm') + ' correo a ' + to + ': "' + subject + '"' +
    (adjuntos.length ? ' · 📎 ' + adjuntos.map(function (f) { return f.name + ' (' + f.n + ' cuenta' + (f.n > 1 ? 's' : '') + ')'; }).join(', ') : '');
  d.rows.forEach(function (r) {
    if (ids.indexOf(r.ID) < 0) return;
    first = first || r;
    r.Notas = (r.Notas ? r.Notas + '\n' : '') + log;
    if (r.Tipo === 'Espera') {   // recordatorio: sigue esperando, te aviso otra vez en 3 días hábiles
      r.Fecha = escAddBizDays_(today, 3); r.GmailThread = r.GmailThread || threadId;
    } else { r.Estado = 'Hecho'; r.HechoEl = now; }
    r.Actualizado = now;
    escWrite_(d.sh, d.headers, r);
    touched.push(escClean_(r));
  });
  var e = b.espera || {};
  if (e.quien && !(first && first.Tipo === 'Espera')) {
    created = { ID: escId_('T'), Tipo: 'Espera', Titulo: String(e.titulo || subject).slice(0, 200), EsperaDe: String(e.quien),
      Categoria: e.categoria || (/@cellmart\.us/i.test(to) ? 'Cellmart' : ''), Prioridad: 'Normal', Monto: e.monto ? String(Number(e.monto) || '') : '',
      LigaTipo: e.ligaTipo || '', LigaValor: e.ligaValor || '', EnviadoEl: today, Fecha: escAddBizDays_(today, 3), Estado: 'Abierto',
      Origen: 'correo', GmailThread: threadId, Asignado: escWho_(), CreadoPor: escWho_(), Notas: log, Creado: now, Actualizado: now };
    escWrite_(d.sh, d.headers, created);
    created = escClean_(created);
  }
  // ＋ Pendiente para ti (lo que prometiste en este correo), ligado al mismo hilo
  var tarea = null, tq = b.tarea || {};
  if (String(tq.titulo || '').trim()) {
    var tf = String(tq.fecha || '');
    tarea = { ID: escId_('T'), Tipo: 'Tarea', Titulo: String(tq.titulo).trim().slice(0, 200), Categoria: tq.categoria || (/@cellmart\.us/i.test(to) ? 'Cellmart' : ''),
      Prioridad: tf && escDaysBetween_(today, tf) <= 2 ? 'Alta' : 'Normal', Fecha: /^\d{4}-\d{2}-\d{2}$/.test(tf) ? tf : escAddBizDays_(today, 2),
      Estado: 'Abierto', Origen: 'correo', GmailThread: threadId, AutoKey: 'prom:' + msg.getId(), Asignado: String(tq.asignado || escWho_()), CreadoPor: escWho_(),
      Notas: '🤝 Lo prometiste en el correo a ' + to + ': "' + subject + '"', Creado: now, Actualizado: now };
    escWrite_(d.sh, d.headers, tarea);
    tarea = escClean_(tarea);
  }
  return { ok: true, threadId: threadId, items: touched, espera: created, tarea: tarea, adjuntos: adjuntos.map(function (f) { return f.name; }) };
}

// ─── Formato de disputa de Cellmart (Disputas.gs) ─────────────────
/** body: { cuentas:[], itemIds:[], hints:{} } → filas para revisar en el Hub */
function escDispRows_(body) {
  var cuentas = (body.cuentas || []).slice();
  var hints = body.hints || {};
  if ((body.itemIds || []).length) {
    escRead_(ESC_TASKS, ESC_TASK_HEADERS).rows.forEach(function (r) {
      if (body.itemIds.indexOf(r.ID) < 0) return;
      var c = r.LigaTipo === 'cuenta' ? escDigits_(r.LigaValor) : '';
      var found = [];
      if (c) found.push(c);
      else (String(r.Titulo + ' ' + r.Notas).match(/8260\d{12}/g) || []).forEach(function (x) { found.push(x); });
      // "Esperando respuesta" de una disputa que ya mandaste: las cuentas salen del correo del hilo
      if (!found.length && r.GmailThread) {
        try {
          GmailApp.getThreadById(String(r.GmailThread)).getMessages().forEach(function (m) {
            (String(m.getPlainBody() || '').match(/8260\d{12}/g) || []).forEach(function (x) { if (found.indexOf(x) < 0) found.push(x); });
          });
        } catch (e) {}
      }
      if (!found.length) return;
      found.forEach(function (x) { if (cuentas.indexOf(x) < 0) cuentas.push(x); });
      if (found.length !== 1) return;
      c = found[0];
      var h = hints[c] = hints[c] || {};
      if (Number(r.Monto) && h.esperado === undefined) h.esperado = Number(r.Monto);
      var t = r.Titulo + ' ' + r.Notas;
      if (!h.psu) h.psu = /internet/i.test(t) ? 'Internet' : /l[ií]nea|mobile|m[oó]vil/i.test(t) ? 'Mobile' : /\btv\b|video/i.test(t) ? 'TV' : '';
      if (!h.motivo && /diferencia|de menos|cargo|chargeback|descuento/i.test(t)) h.motivo = 'Incorrect payouts';
    });
  }
  var out = dispRows_(cuentas, hints);
  try { var t = dispTemplate_(); out.formato = t.name; out.formatoFecha = t.fecha; }
  catch (e) { out.formatoError = e.message; }
  out.agente = (typeof DISP_FULL_NAMES !== 'undefined' && DISP_FULL_NAMES[escWho_()]) || escWho_();
  return out;
}
/** Para descargar y revisar el archivo antes de mandarlo. */
function escDispFile_(body) {
  return { ok: true, files: dispFiles_(body.rows, body.fecha).map(function (f) {
    return { name: f.name, n: f.n, b64: Utilities.base64Encode(f.blob.getBytes()) };
  }) };
}

/** Correr una vez después de actualizar (▶ Run) para aceptar los permisos de Gmail. No manda nada. */
function probarCorreo() {
  var me = Session.getEffectiveUser().getEmail();
  var n = GmailApp.search('from:cellmart.us (allocated OR allocation) newer_than:21d', 0, 10).length;
  Logger.log('Listo: los correos saldrán desde ' + me + '. Correos de teléfonos asignados en las últimas 3 semanas: ' + n + '.');
}

/** Correo de la cuenta (para saber qué mensajes son tuyos). Sin permiso extra, usa el de MirComm. */
function escMe_() {
  try { return String(Session.getEffectiveUser().getEmail() || 'mircommllc@gmail.com').toLowerCase(); }
  catch (e) { return 'mircommllc@gmail.com'; }
}

// ─── Quién está conectado (Admins.gs) ──────────────────────────────
function escWho_() { return typeof adminMe_ === 'function' ? adminMe_() : 'Joel'; }
function escFirma_() { return typeof adminFirma_ === 'function' ? adminFirma_() : ESC_SIGNATURE; }
function escFromName_() { return typeof adminFromName_ === 'function' ? adminFromName_() : 'Joel Chavez - MirComm LLC'; }

// ─── Fase 2: "Esperando respuesta" se revisa solo en Gmail ────────
// Cada vez que se abre Mi Escritorio, revisa el hilo de Gmail de cada "Esperando respuesta" abierto.
// Si después de tu último correo llegó uno de la otra persona, el pendiente sale como 📩 "Ya contestó"
// (con un pedacito de la respuesta). Si no tiene hilo pero sabemos su correo (Esc_Contactos o el
// correo escrito en "Esperando de"), busca en Gmail si te escribió desde que lo anotaste y liga el hilo.
var ESC_WAIT_MAX = 40;   // tope de hilos a revisar por carga (para que Mi Escritorio abra rápido)

function escWaitCheck_(d, items) {
  var me = escMe_(), byId = {}, contacts = null, n = 0, linked = [];
  items.forEach(function (i) { byId[i.ID] = i; });
  d.rows.forEach(function (r) {
    if (r.Estado !== 'Abierto' || r.Tipo !== 'Espera' || n >= ESC_WAIT_MAX) return;
    var it = byId[r.ID]; if (!it) return;
    var th = null;
    if (r.GmailThread) {
      n++;
      try { th = GmailApp.getThreadById(String(r.GmailThread)); } catch (e) {}
    } else {
      if (contacts === null) { try { contacts = escContactsRead_().rows; } catch (e) { contacts = []; } }
      var email = escWaitEmail_(r, contacts);
      var since = String(r.EnviadoEl || r.Creado || '').slice(0, 10);
      if (!email || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return;
      n++;
      var found = GmailApp.search('from:' + email + ' after:' + since.replace(/-/g, '/') + ' -in:sent -in:drafts', 0, 1);
      if (!found.length) return;
      th = found[0];
    }
    if (!th) return;
    var resp = escWaitReply_(th, r, me);
    if (!resp) return;
    it.Resp = resp;
    if (!r.GmailThread) { r.GmailThread = th.getId(); it.GmailThread = r.GmailThread; linked.push(r); }
  });
  if (linked.length) escLocked_(function () {   // guarda el hilo que encontró, para que ✉ conteste en el mismo hilo
    linked.forEach(function (r) { r.Actualizado = escFmt_(new Date()); escWrite_(d.sh, d.headers, r); });
  });
}

/** Correo de la persona que esperas: el que esté escrito en "Esperando de", o el de un contacto con ese nombre. */
function escWaitEmail_(r, contacts) {
  var de = String(r.EsperaDe || '').trim();
  var m = de.match(/[^<\s,;"]+@[^>\s,;"]+\.[a-z]{2,}/i);
  if (m) return m[0].toLowerCase();
  var k = de.toLowerCase();
  if (!k || k.length < 3) return '';
  var hits = contacts.filter(function (c) {
    var nm = String(c.Nombre || '').toLowerCase().trim();
    return c.Correo && nm && (nm === k || nm.split(/\s+/)[0] === k || k.split(/\s+/)[0] === nm.split(/\s+/)[0] && nm.split(/\s+/)[0].length > 3);
  });
  return hits.length === 1 ? String(hits[0].Correo).toLowerCase().trim() : '';
}

/** ¿Llegó respuesta de la otra persona después de tu último correo (o después de que lo anotaste)? */
function escWaitReply_(th, r, me) {
  var msgs = th.getMessages().filter(function (m) { try { return !m.isDraft(); } catch (e) { return true; } });
  var mine = function (m) { return String(m.getFrom()).toLowerCase().indexOf(me) >= 0; };
  var lastMine = -1;
  msgs.forEach(function (m, i) { if (mine(m)) lastMine = i; });
  var cut = null;
  if (lastMine < 0) { try { cut = Utilities.parseDate(String(r.Creado || r.EnviadoEl).slice(0, 16), escTz_(), String(r.Creado || '').length >= 16 ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd'); } catch (e) {} }
  var theirs = msgs.slice(lastMine + 1).filter(function (m) { return !mine(m) && (!cut || m.getDate() > cut); });
  var real = theirs.filter(function (m) { return !escAutoReply_(m); });
  if (!theirs.length) return null;
  var last = real.length ? real[real.length - 1] : theirs[theirs.length - 1];
  if (r.RespVisto && r.RespVisto === last.getId()) return null;   // ya la viste y decidiste seguir esperando
  var fromRaw = String(last.getFrom());
  var de = (fromRaw.match(/<([^>]+)>/) || [0, fromRaw])[1].trim().toLowerCase();
  var nombre = fromRaw.replace(/<.*>/, '').replace(/"/g, '').trim() || de;
  var txt = String(last.getPlainBody() || '').split(/\n_{8,}|\nFrom: |\nOn .{5,80} wrote:|\nEl .{5,80} escribió:|\n-{2,}\s*Original Message/)[0]
    .replace(/\s+/g, ' ').trim().slice(0, 280);
  var rebote = /mailer-daemon|postmaster/i.test(fromRaw);
  return {
    de: de, nombre: nombre, fecha: escFmt_(last.getDate(), 'yyyy-MM-dd HH:mm'), txt: txt, msgId: last.getId(), n: real.length || theirs.length,
    auto: !real.length && !rebote,   // solo llegó una respuesta automática (fuera de la oficina)
    rebote: rebote,                  // el correo rebotó
    cierre: !rebote && !!real.length && /\b(approved|credited|processed|has been paid|resolved|completed|issued|aprobad[oa]|acreditad[oa]|pagad[oa]|resuelt[oa]|ya qued[oó])\b/i.test(txt)
  };
}
function escAutoReply_(m) {
  try { if (/auto-(replied|generated)/i.test(String(m.getHeader('Auto-Submitted') || ''))) return true; } catch (e) {}
  return /automatic reply|auto-?reply|out of (the )?office|respuesta autom[aá]tica|fuera de (la )?oficina/i.test(String(m.getSubject() || ''))
    || /mailer-daemon|postmaster/i.test(String(m.getFrom()));
}

/** "Sigo esperando": ya viste su respuesta pero aún falta lo importante. Te aviso otra vez en N días hábiles. */
function escWaitAck_(b) {
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  var r = d.rows.filter(function (x) { return x.ID === String(b.id || ''); })[0];
  if (!r) throw new Error('No encontré ese pendiente.');
  var today = escToday_(), dias = Math.max(1, Math.min(15, Number(b.dias) || 3));
  r.RespVisto = String(b.msgId || '');
  r.Fecha = escAddBizDays_(today, dias);
  r.Notas = (r.Notas ? r.Notas + '\n' : '') + '📩 ' + escFmt_(new Date()) + ' contestó ' + String(b.de || r.EsperaDe || '') + ' — ' + escWho_() + ' sigue esperando (aviso el ' + r.Fecha + ')';
  r.Actualizado = escFmt_(new Date());
  escWrite_(d.sh, d.headers, r);
  return { ok: true, item: escClean_(r) };
}

/** Prueba (▶ Run): muestra en el registro qué "Esperando respuesta" ya tienen contestación. No cambia nada. */
function probarEsperas() {
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  var items = d.rows.filter(function (r) { return r.Estado === 'Abierto' && r.Tipo === 'Espera'; }).map(escClean_);
  escWaitCheck_(d, items);
  items.forEach(function (i) {
    Logger.log((i.Resp ? '📩 ' + i.Resp.nombre + ' contestó el ' + i.Resp.fecha + (i.Resp.auto ? ' (respuesta automática)' : '') : '⏳ sin respuesta') + ' · ' + i.Titulo);
  });
  Logger.log(items.length + ' esperando respuesta revisados.');
}


// ─── 🤝 Promesas: lo que dices que vas a hacer en tus correos ─────
// "We will ship the defective phone to your store by the end of the week" → pendiente para el viernes.
// La Bandeja lo propone (＋ A mis pendientes) y la ventana de correo lo detecta antes de enviar.
var ESC_PROM_DIAS = 10;

/** Saca las promesas de un texto. sentYmd = fecha del correo. → [{ frase, fecha }] */
function escPromesas_(text, sentYmd) {
  var body = String(text || '').split(/\n_{8,}|\nFrom: |\nOn .{5,120} wrote:|\nEl .{5,120} escribi[oó]:|\n-{2,}\s*Original Message/)[0];
  var sent = /^\d{4}-\d{2}-\d{2}$/.test(sentYmd) ? sentYmd : escToday_();
  var subj = /\b(?:I|we)\s*(?:will|'ll|’ll|am going to|are going to|plan to|can)\b|\b(?:voy|vamos)\s+a\b|\b(?:te|le|les)\s+(?:mando|envío|envio|llamo|llevo|pago)\b|\b(?:mandar|enviar|llamar|pagar|llevar|regresar)[eé]\b|\b(?:mandaremos|enviaremos|llamaremos|pagaremos)\b/i;
  var verb = /\b(ship(?:ping)?|send|mail|drop(?:\s+\w+)?\s+off|bring|call|deliver|return|submit|forward|pay|e-?mail|text|follow up|get back to you|mandar|enviar|llevar|llamar|pagar|regresar|devolver|entregar|mando|env[ií]o|llamo|llevo|pago|mandar[eé]|enviar[eé]|llamar[eé]|pagar[eé]|llevar[eé]|mandaremos|enviaremos|llamaremos|pagaremos)\b/i;
  var out = [];
  body.split(/(?:[.!?]+\s+)|\n+/).forEach(function (sen) {
    sen = sen.replace(/\s+/g, ' ').trim();
    if (sen.length < 8 || /\?$/.test(sen) || /^(could|can|would|please|will you|podr[ií]a|puede|me puede)/i.test(sen)) return;
    var sm = sen.match(subj); if (!sm) return;
    var rest = sen.slice(sm.index), vm = rest.match(verb); if (!vm) return;
    var frase = rest.slice(vm.index).replace(/^(?:and|y)\s+/i, '').replace(/[.!,;:]+$/, '').slice(0, 110).trim();
    out.push({ frase: frase, fecha: escPromFecha_(sen, sent) });
  });
  return out.slice(0, 4);
}
function escPromFecha_(s, sent) {
  var dow = function (ymd) { var p = ymd.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12).getDay(); };
  var next = function (target, minAdd) { var d = escAddDays_(sent, minAdd); while (dow(d) !== target) d = escAddDays_(d, 1); return d; };
  var t = s.toLowerCase();
  if (/\b(today|tonight|right away|asap|immediately|hoy|ahorita|de inmediato)\b/.test(t)) return sent;
  if (/\b(tomorrow|ma[ñn]ana)\b/.test(t)) return escAddDays_(sent, 1);
  if (/end of (the |this )?week|this week|esta semana|fin de semana|by friday|el viernes|para el viernes/.test(t)) return dow(sent) === 6 || dow(sent) === 0 ? next(5, 1) : next(5, 0);
  if (/next week|la (pr[oó]xima|otra) semana/.test(t)) return next(1, 1);
  var dias = { monday: 1, lunes: 1, tuesday: 2, martes: 2, wednesday: 3, 'miércoles': 3, miercoles: 3, thursday: 4, jueves: 4, friday: 5, viernes: 5, saturday: 6, 'sábado': 6, sabado: 6 };
  for (var k in dias) if (new RegExp('\\b' + k + '\\b').test(t)) return next(dias[k], 1);
  return escAddBizDays_(sent, 2);
}

/** Bandeja: promesas en tus correos enviados (a Cellmart y a tus contactos) de los últimos días sin pendiente. */
function escPromInbox_(tasks, today, add) {
  var me = escMe_(), contacts = [];
  try { contacts = escContactsRead_().rows; } catch (e) {}
  var mails = contacts.map(function (c) { return String(c.Correo || '').toLowerCase().trim(); }).filter(function (x) { return /@/.test(x); });
  var dom = mails.filter(function (x) { return !/@cellmart\.us$/.test(x); }).slice(0, 15);
  var q = 'in:sent newer_than:' + ESC_PROM_DIAS + 'd (to:cellmart.us' + dom.map(function (x) { return ' OR to:' + x; }).join('') + ')';
  var hasTask = {};   // hilo → ya tiene un pendiente creado después de ese correo
  tasks.forEach(function (r) { if (r.Tipo === 'Tarea' && r.GmailThread && r.Estado !== 'Descartado') (hasTask[r.GmailThread] = hasTask[r.GmailThread] || []).push(String(r.Creado || '')); });
  GmailApp.search(q, 0, 15).forEach(function (th) {
    var msgs = th.getMessages();
    for (var i = msgs.length - 1; i >= 0; i--) {
      var m = msgs[i];
      try { if (m.isDraft()) continue; } catch (e) {}
      if (String(m.getFrom()).toLowerCase().indexOf(me) < 0) continue;
      var when = escFmt_(m.getDate()), sentYmd = when.slice(0, 10);
      if (escDaysBetween_(sentYmd, today) > ESC_PROM_DIAS) return;
      var proms = escPromesas_(m.getPlainBody(), sentYmd);
      if (!proms.length) continue;
      if ((hasTask[th.getId()] || []).some(function (c) { return c >= when; })) return;   // ya hiciste el pendiente
      var toEmail = (String(m.getTo() || '').match(/[^<\s,;"]+@[^>\s,;"]+/) || [''])[0].toLowerCase();
      var c = contacts.filter(function (x) { return String(x.Correo || '').toLowerCase().trim() === toEmail; })[0];
      var quien = c ? String(c.Nombre).split(' ')[0] : (toEmail.split('@')[0] || 'ellos');
      var fecha = proms.map(function (p) { return p.fecha; }).sort()[0];
      var frase0 = proms[0].frase.charAt(0).toUpperCase() + proms[0].frase.slice(1);
      add({ key: 'prom:' + m.getId(), tipo: 'promesa', thread: th.getId(), de: toEmail,
        titulo: 'Le prometiste a ' + quien + ': ' + frase0,
        detalle: proms.map(function (p) { return '“' + p.frase + '” → ' + escNice_(p.fecha); }).join(' · ') + ' — correo del ' + escNice_(sentYmd) + ': ' + th.getFirstMessageSubject(),
        item: { Titulo: 'Cumplir con ' + quien + ': ' + frase0.slice(0, 150), Categoria: /@cellmart\.us$/.test(toEmail) ? 'Cellmart' : '',
          Prioridad: escDaysBetween_(today, fecha) <= 2 ? 'Alta' : 'Normal', Fecha: fecha < today ? today : fecha, GmailThread: th.getId(),
          Notas: '🤝 Lo prometiste el ' + escNice_(sentYmd) + ' (' + th.getFirstMessageSubject() + '):\n' + proms.map(function (p) { return '• ' + p.frase; }).join('\n') } });
      return;   // solo el correo tuyo más reciente de cada hilo
    }
  });
}


// ─── 🎯 Metas semanales (Fase 3) ──────────────────────────────────
// Metas de la tienda y por persona: internet, líneas y líneas extra (las que traen después de la primera gratis).
// Se guardan en Script Properties → ESC_METAS = { base: {...}, semanas: { 'lunes yyyy-MM-dd': {...} } }.
// El avance se calcula en el Hub con las activaciones (OrderDate de lunes a domingo).
var ESC_METAS_KEY = 'ESC_METAS';
var ESC_METAS_KEYS = ['internet', 'lineas', 'extra'];

function escMetasRead_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(ESC_METAS_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function escWeekStart_(ymd) {
  var p = String(ymd).split('-').map(Number), w = new Date(p[0], p[1] - 1, p[2], 12).getDay();
  return escAddDays_(ymd, w === 0 ? -6 : 1 - w);
}
function escMetasSave_(b) {
  var clean = function (o) {
    var r = {};
    ESC_METAS_KEYS.forEach(function (k) { var n = Math.round(Number(o && o[k])); if (n > 0) r[k] = Math.min(n, 999); });
    return r;
  };
  var m = b.metas || {}, out = { tienda: clean(m.tienda), personas: {}, quien: escWho_(), el: escFmt_(new Date()) };
  Object.keys(m.personas || {}).forEach(function (p) {
    var c = clean(m.personas[p]);
    if (Object.keys(c).length) out.personas[String(p).trim().slice(0, 40)] = c;
  });
  var hoy = escWeekStart_(escToday_());
  var ws = /^\d{4}-\d{2}-\d{2}$/.test(String(b.semana || '')) ? escWeekStart_(String(b.semana)) : hoy;
  var all = escMetasRead_();
  all.semanas = all.semanas || {};
  all.semanas[ws] = out;
  if (ws >= hoy) all.base = out;   // de esta semana en adelante; corregir una semana pasada no cambia las que siguen
  Object.keys(all.semanas).sort().slice(0, -26).forEach(function (k) { delete all.semanas[k]; });
  PropertiesService.getScriptProperties().setProperty(ESC_METAS_KEY, JSON.stringify(all));
  return { ok: true, metas: all };
}


// ─── 📅 Pendientes con hora → Google Calendar (Fase 3) ────────────
// Cada pendiente abierto con fecha y hora sale en tu Google Calendar (el de mircommllc@gmail.com) con aviso 15 min antes.
// Si lo cambias de fecha/hora, se mueve; si lo marcas hecho o lo borras, se quita. Si es de Lizbeth o Alondra y tienen
// correo en SEG_CORREOS (Seguimiento.gs), les llega la invitación.
var ESC_CAL_AVISO_MIN = 15;
var ESC_CAL_DURACION_MIN = 30;

function escCalSync_(r) {
  try {
    var want = r.Tipo !== 'Espera' && r.Estado === 'Abierto' && /^\d{4}-\d{2}-\d{2}$/.test(String(r.Fecha || '')) && /^\d{1,2}:\d{2}/.test(String(r.Hora || ''));
    var sig = want ? [r.Fecha, String(r.Hora).slice(0, 5), r.Titulo, r.Asignado || ''].join('|') : '';
    if (sig === String(r.EventoSig || '') && (!want || r.EventoCal)) return;   // nada cambió
    var cal = CalendarApp.getDefaultCalendar();
    if (r.EventoCal) { escCalDelete_(r.EventoCal, cal); r.EventoCal = ''; }
    r.EventoSig = sig;
    if (!want) return;
    var p = r.Fecha.split('-').map(Number), h = String(r.Hora).split(':').map(Number);
    var start = new Date(p[0], p[1] - 1, p[2], h[0], h[1] || 0);
    var end = new Date(start.getTime() + ESC_CAL_DURACION_MIN * 60000);
    var who = String(r.Asignado || ''), guest = '';
    if (who && who !== escWho_() && typeof segCorreos_ === 'function') { try { guest = segCorreos_()[who] || ''; } catch (e) {} }
    var ev = cal.createEvent('✅ ' + String(r.Titulo).slice(0, 120) + (who && who !== 'Joel' ? ' · ' + who : ''), start, end, {
      description: (r.Notas ? String(r.Notas).slice(0, 900) + '\n\n' : '') + 'Pendiente del MirComm Store Hub' + (r.Categoria ? ' · ' + r.Categoria : '') +
        (r.GmailThread ? '\nCorreo: https://mail.google.com/mail/u/0/#all/' + r.GmailThread : '') + '\nhttps://mircommllc.github.io/mircomm-inventory/',
      guests: guest, sendInvites: !!guest
    });
    ev.removeAllReminders();
    ev.addPopupReminder(ESC_CAL_AVISO_MIN);
    r.EventoCal = ev.getId();
  } catch (e) { /* el calendario es opcional: si falla, el pendiente se guarda igual */ }
}
function escCalDelete_(id, cal) {
  try { cal = cal || CalendarApp.getDefaultCalendar(); var ev = cal.getEventById(String(id)); if (ev) ev.deleteEvent(); } catch (e) {}
}

// ─── ☀ Correo de la mañana (Fase 3) ───────────────────────────────
// Lunes a sábado a las 7:30 am: tus prioridades, vencidos, lo de hoy, quién ya contestó, lo que prometiste,
// la Bandeja y cómo van las metas de la semana. Los lunes, la revisión de la semana pasada.
// INSTALAR: selecciona instalarCorreoManana → ▶ Run (una vez). Para probar ahora: probarCorreoManana → ▶ Run.
var ESC_MANANA_HORA = 7;          // 7:30 am (antes del resumen del equipo de las 8:30)
var ESC_MANANA_PARA = '';         // vacío = mircommllc@gmail.com; puedes poner varios separados por coma
var ESC_HUB_URL = 'https://mircommllc.github.io/mircomm-inventory/';

function instalarCorreoManana() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'escCorreoManana') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('escCorreoManana').timeBased().atHour(ESC_MANANA_HORA).nearMinute(30).everyDays(1).create();
  Logger.log('Listo: el correo de la mañana sale todos los días (menos domingo) a las ' + ESC_MANANA_HORA + ':30 am a ' + (ESC_MANANA_PARA || escMe_()) + '.');
}
function probarCorreoManana() { escCorreoManana(true); Logger.log('Mandé el correo de la mañana a ' + (ESC_MANANA_PARA || escMe_()) + '.'); }

function escCorreoManana(forzar) {
  var today = escToday_(), dow = escDow_(today);
  if (dow === 0 && forzar !== true) return;   // domingo no
  var d = escRead_(ESC_TASKS, ESC_TASK_HEADERS);
  var open = d.rows.filter(function (r) { return r.Estado === 'Abierto'; });
  var tasks = open.filter(function (r) { return r.Tipo !== 'Espera'; });
  var waits = open.filter(function (r) { return r.Tipo === 'Espera'; }).map(escClean_);
  try { escWaitCheck_(d, waits); } catch (e) {}
  var sortT = function (a, b) { return (String(a.Fecha) + (a.Hora || '99')).localeCompare(String(b.Fecha) + (b.Hora || '99')); };
  var top = tasks.filter(function (r) { return r.Top3 === today; });
  var venc = tasks.filter(function (r) { return r.Fecha && r.Fecha < today; }).sort(sortT);
  var hoy = tasks.filter(function (r) { return r.Fecha === today && r.Top3 !== today; }).sort(sortT);
  var resp = waits.filter(function (w) { return w.Resp && !w.Resp.auto; });
  var tarde = waits.filter(function (w) { return !(w.Resp && !w.Resp.auto) && w.Fecha && w.Fecha <= today; });
  var inbox = [];
  try { inbox = escInbox_(d.rows, today); } catch (e) {}
  var prom = inbox.filter(function (x) { return x.tipo === 'promesa'; });
  var otros = inbox.filter(function (x) { return x.tipo !== 'promesa'; });
  var ws = escWeekStart_(today), metas = escMetasRead_();
  var st = null, prev = null;
  try { st = escWeekStats_(ws); if (dow === 1) prev = escWeekStats_(escAddDays_(ws, -7)); } catch (e) {}
  var money = tasks.reduce(function (s, r) { return s + (Number(r.Monto) || 0); }, 0);

  var E = escEsc_, H = [];
  var li = function (r, extra) {
    return '<li style="margin:4px 0">' + (r.Hora ? '<b>' + escHour12_(r.Hora) + '</b> · ' : '') + E(r.Titulo) +
      (Number(r.Monto) ? ' <span style="color:#1e8e3e">$' + Number(r.Monto).toLocaleString('en-US') + '</span>' : '') +
      (r.Asignado && r.Asignado !== 'Joel' ? ' <span style="color:#7a5ccc">→ ' + E(r.Asignado) + '</span>' : '') + (extra || '') + '</li>';
  };
  var sec = function (title, color, items) { return items.length ? '<h3 style="margin:18px 0 6px;color:' + color + ';font-size:15px">' + title + '</h3><ul style="margin:0;padding-left:20px">' + items.join('') + '</ul>' : ''; };

  H.push('<p style="font-size:16px;margin:0 0 4px">Buenos días, Joel.</p><p style="color:#5b6b85;margin:0">' + E(escDowName_(dow)) + ' ' + escNice_(today) +
    ' · ' + tasks.length + ' pendientes abiertos' + (money ? ' · $' + money.toLocaleString('en-US') + ' en juego' : '') + '</p>');
  if (prev) H.push(escMetasHtml_('📊 Revisión del lunes: cómo cerró la semana pasada', prev, escMetasDe_(metas, escAddDays_(ws, -7)), 6, escWeekStats_(escAddDays_(ws, -14))));
  H.push(sec('★ Tus 3 prioridades', '#b8860b', top.map(function (r) { return li(r); })));
  if (!top.length) H.push('<p style="margin:14px 0 0;color:#5b6b85">☀ Todavía no escoges tus 3 prioridades de hoy: hazlo en "Planear mi día".</p>');
  H.push(sec('⚠️ Vencidos (' + venc.length + ')', '#c0392b', venc.slice(0, 10).map(function (r) { return li(r, ' <span style="color:#c0392b">· ' + escDue_(r.Fecha, today) + '</span>'); })
    .concat(venc.length > 10 ? ['<li style="color:#5b6b85">y ' + (venc.length - 10) + ' más…</li>'] : [])));
  H.push(sec('📅 Para hoy (' + hoy.length + ')', '#0A1F3C', hoy.map(function (r) { return li(r); })));
  H.push(sec('📩 Ya te contestaron', '#1e8e3e', resp.map(function (w) {
    return '<li style="margin:6px 0"><b>' + E(w.Resp.nombre || w.EsperaDe) + '</b> · ' + E(w.Titulo) + '<br><span style="color:#5b6b85">"' + E(w.Resp.txt.slice(0, 200)) + '"</span></li>'; })));
  H.push(sec('⏰ Toca recordarles', '#b8860b', tarde.map(function (w) {
    return '<li style="margin:4px 0"><b>' + E(w.EsperaDe) + '</b> · ' + E(w.Titulo) + (w.EnviadoEl ? ' <span style="color:#5b6b85">(mandado ' + escDue_(String(w.EnviadoEl).slice(0, 10), today) + ')</span>' : '') + '</li>'; })));
  H.push(sec('🤝 Lo que prometiste', '#7a5ccc', prom.map(function (x) { return '<li style="margin:4px 0">' + E(x.titulo) + '<br><span style="color:#5b6b85">' + E(x.detalle) + '</span></li>'; })));
  H.push(sec('📥 En tu Bandeja (' + otros.length + ')', '#0A1F3C', otros.slice(0, 6).map(function (x) { return '<li style="margin:4px 0">' + E(x.titulo) + '</li>'; })
    .concat(otros.length > 6 ? ['<li style="color:#5b6b85">y ' + (otros.length - 6) + ' más…</li>'] : [])));
  if (st) H.push(escMetasHtml_('🎯 Metas de esta semana', st, escMetasDe_(metas, ws), Math.min(6, escDaysBetween_(ws, today)), null));
  var pay = escNextPayday_(today);
  if (pay && escDaysBetween_(today, pay) <= 3) H.push('<p style="margin:18px 0 0">💵 <b>Pago de Cellmart ' + (pay === today ? 'hoy' : 'el ' + escDowName_(escDow_(pay)) + ' ' + escNice_(pay)) +
    '</b>: después sube el Commission Report en Activaciones. Recuerda: 7 días para disputar.</p>');

  var subject = '☀ Tu día: ' + (venc.length ? '⚠️ ' + venc.length + ' vencido' + (venc.length > 1 ? 's' : '') + ' · ' : '') + (top.length + hoy.length) + ' para hoy' +
    (resp.length ? ' · 📩 ' + resp.length + (resp.length === 1 ? ' contestó' : ' contestaron') : '') + (st && escMetasDe_(metas, ws) ? ' · 🎯 ' + st.tienda.internet + ' internet / ' + st.tienda.lineas + ' líneas' : '');
  MailApp.sendEmail({ to: ESC_MANANA_PARA || escMe_(), subject: subject, name: 'MirComm Store Hub',
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0A1F3C;max-width:640px;line-height:1.45">' + H.join('') +
      '<p style="margin-top:24px"><a href="' + ESC_HUB_URL + '" style="background:#00D4FF;color:#0A1F3C;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir Store Hub</a></p></div>' });
}

// Avance de la semana con la hoja Activations (mismas reglas que la tarjeta 🎯 del Hub)
function escWeekStats_(ws) {
  var we = escAddDays_(ws, 6), rows = escRowsOf_('Activations');
  var reps = {}; try { if (typeof actRepMap_ === 'function') reps = actRepMap_(); } catch (e) {}
  ['CMMCL4423:Joel', 'CMMLB4896:Lizbeth', 'CMMLB4898:Alondra'].forEach(function (x) { var k = x.split(':'); if (!reps[k[0]]) reps[k[0]] = k[1]; });
  var acct = function (r) { return String(r.AccountNumber || '').replace(/\D/g, ''); };
  var has = function (v) { var s = String(v == null ? '' : v).trim(); return !!s && !/^(n\/?a|none|—|-|0)$/i.test(s); };
  var pkg = function (r) { return r.Source === 'Email' && Number(r.MobileLines) > 0 && !r.MobileOrder && !String(r.IMEIs || '').trim() && !r.LinePhones && !r.MobileType; };
  var out = { tienda: { internet: 0, lineas: 0, extra: 0 }, por: {} };
  rows.forEach(function (r) {
    var d = String(r.OrderDate || '').slice(0, 10);
    if (!d || d < ws || d > we) return;
    var internet = has(r.InternetTier) ? 1 : 0, lineas = pkg(r) ? 0 : (Number(r.MobileLines) || 0);
    if (!internet && !lineas) return;
    var tipo = r.MobileType;
    if (!tipo && lineas) tipo = rows.some(function (x) { return x !== r && acct(x) && acct(x) === acct(r) && Number(x.MobileLines) > 0 && String(x.OrderDate) < String(r.OrderDate); }) ? 'Incremental' : 'Primera';
    var extra = Math.max(0, lineas - (lineas > 0 && tipo !== 'Incremental' ? 1 : 0));
    var who = r.SoldBy || r.Employee || reps[String(r.RepID || '').toUpperCase()] || r.RepID || '—';
    if (who === 'Lizbeth' && d >= '2026-06-01' && d <= '2026-10-11') who = 'Alondra';   // igual que ACT_REP_HANDOVER del Hub
    var p = out.por[who] = out.por[who] || { internet: 0, lineas: 0, extra: 0 };
    p.internet += internet; p.lineas += lineas; p.extra += extra;
    out.tienda.internet += internet; out.tienda.lineas += lineas; out.tienda.extra += extra;
  });
  return out;
}
function escMetasDe_(m, ws) {
  if (m.semanas && m.semanas[ws]) return m.semanas[ws];
  var prev = Object.keys(m.semanas || {}).filter(function (k) { return k <= ws; }).sort().pop();
  return prev ? m.semanas[prev] : null;
}
function escMetasHtml_(title, st, g, elapsed, vs) {
  var L = [['internet', '🌐 Internet'], ['lineas', '📱 Líneas'], ['extra', '🔁 Líneas extra']];
  var cell = function (act, goal) {
    if (!goal) return '<b>' + act + '</b>';
    var pace = goal * elapsed / 6;
    var c = act >= goal || (pace && act >= pace) ? '#1e8e3e' : !pace ? '#0A1F3C' : act >= pace * 0.7 ? '#b8860b' : '#c0392b';
    return '<b style="color:' + c + '">' + act + '</b><span style="color:#5b6b85"> / ' + goal + '</span>';
  };
  var goal = function (who, k) { return g ? Number(who ? ((g.personas || {})[who] || {})[k] : (g.tienda || {})[k]) || 0 : 0; };
  var people = Object.keys((g && g.personas) || {}).concat(Object.keys(st.por)).filter(function (p, i, a) { return p !== '—' && a.indexOf(p) === i; });
  var td = 'style="padding:5px 14px 5px 0;border-top:1px solid #e3e8f0"';
  return '<h3 style="margin:20px 0 6px;font-size:15px">' + title + '</h3><table style="border-collapse:collapse;font-size:14px">' +
    '<tr><td></td>' + L.map(function (x) { return '<td style="padding:4px 14px 4px 0;color:#5b6b85;font-size:12px">' + x[1] + '</td>'; }).join('') + '</tr>' +
    '<tr><td ' + td + '><b>Tienda</b></td>' + L.map(function (x) { return '<td ' + td + '>' + cell(st.tienda[x[0]], goal('', x[0])) +
      (vs ? ' <span style="color:#5b6b85;font-size:12px">(antes ' + vs.tienda[x[0]] + ')</span>' : '') + '</td>'; }).join('') + '</tr>' +
    people.map(function (p) { var s = st.por[p] || { internet: 0, lineas: 0, extra: 0 };
      return '<tr><td ' + td + '>' + escEsc_(p) + '</td>' + L.map(function (x) { return '<td ' + td + '>' + cell(s[x[0]], goal(p, x[0])) + '</td>'; }).join('') + '</tr>'; }).join('') +
    '</table>' + (g ? '' : '<p style="color:#5b6b85;font-size:12px;margin:6px 0 0">Sin metas: ponlas en 🎯 Metas y semana.</p>');
}
function escDow_(ymd) { var p = String(ymd).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12).getDay(); }
function escDowName_(n) { return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][n]; }
function escHour12_(hm) { var p = String(hm).split(':').map(Number), ap = p[0] >= 12 ? 'pm' : 'am'; return ((p[0] % 12) || 12) + ':' + ('0' + (p[1] || 0)).slice(-2) + ap; }
function escDue_(ymd, today) { var n = escDaysBetween_(ymd, today); return n === 0 ? 'hoy' : n === 1 ? 'ayer' : n > 0 ? 'hace ' + n + ' días' : 'el ' + escNice_(ymd); }
function escEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escNextPayday_(today) {   // pagos cada 14 días desde ESC_PAYDAY_ANCHOR
  var n = escDaysBetween_(ESC_PAYDAY_ANCHOR, today), r = ((n % 14) + 14) % 14;
  return r === 0 ? today : escAddDays_(today, 14 - r);
}


// ─── 🎯 La meta de cada asesora (recuadro al entrar) y sus seguimientos para el WhatsApp de Joel ──
function escRepGet_(b) {
  if (typeof prosAuth_ !== 'function') throw new Error('Falta Prospectos.gs.');
  var me = prosAuth_(b), today = escToday_(), ws = escWeekStart_(today);
  var g = escMetasDe_(escMetasRead_(), ws), st = escWeekStats_(ws);
  var meta = g && g.personas && g.personas[me.name] ? g.personas[me.name] : null;
  return { ok: true, name: me.name, semana: ws, fin: escAddDays_(ws, 6), dias: Math.min(6, escDaysBetween_(ws, today)),
    meta: meta, hecho: st.por[me.name] || { internet: 0, lineas: 0, extra: 0 } };
}
/** Seguimientos de prospectos por asesora: { Lizbeth: { venc: 3, hoy: 2 } } */
function escSegPor_(today) {
  var out = {};
  try {
    escRowsOf_('Seg_Tareas').forEach(function (s) {
      var f = String(s.Fecha || '').slice(0, 10), a = String(s.Asesora || '');
      if (s.Estado !== 'Pendiente' || !f || !a || f > today) return;
      var o = out[a] = out[a] || { venc: 0, hoy: 0 };
      if (f < today) o.venc++; else o.hoy++;
    });
  } catch (e) {}
  return out;
}
