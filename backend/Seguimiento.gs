/**
 * Seguimiento.gs — Sistema de seguimiento de prospectos de MirComm (Palmhurst)
 * -----------------------------------------------------------------------------
 * Se suma a Prospectos.gs sin cambiarlo. Agrega:
 *  - Etapas (Nuevo → Contactado → Interesado → Cita → Vendido / Perdido / Futuro) y temperatura 🔥🌤❄️.
 *  - Calificación del prospecto (compañía actual, cuánto paga, cuándo puede cambiarse, si decide, cobertura).
 *  - Tareas de seguimiento con fecha y hora (llamar, mensaje, WhatsApp, cita en tienda). Cada prospecto activo
 *    siempre tiene una tarea pendiente.
 *  - Correos: resumen diario a cada asesora (8:30 am), aviso 15 min antes de cada tarea con hora,
 *    y aviso a Joel cuando un prospecto 🔥 caliente lleva más de 48 horas vencido.
 *  - Google Calendar: cada tarea con hora se crea en el calendario "MirComm Seguimiento" e invita a la asesora.
 *
 * Usa: prosAuth_ (Prospectos.gs), isManagerToken_ (Activaciones.gs), SPREADSHEET_ID (Code.gs).
 *
 * INSTALAR (una sola vez):
 *  1. Apps Script: ＋ → Script → nómbralo "Seguimiento" → pega todo este archivo → Guardar.
 *  2. Revisa los correos de SEG_CORREOS (abajo). Pon el de Alondra cuando lo tengas.
 *  3. En Code.gs, dentro de doGet(e), pega esta línea JUSTO DEBAJO de  prosSessionPin_(e);
 *        var sg = seguimientoRouter_(e); if (sg) return sg;
 *  4. Arriba, en la lista de funciones, escoge instalarSeguimiento → Run. Google pide permisos nuevos
 *     (correo y calendario) → Allow. Crea las hojas, el calendario y los avisos automáticos.
 *  5. Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *  Si cambias un correo después, vuelve a correr instalarSeguimiento (no borra nada).
 */

// ─── CONFIGURACIÓN ─────────────────────────────────────────────────
var SEG_CORREOS = {
  Lizbeth: 'jaquelinne@mircommusa.com',
  Alondra: 'spectrumsalesrgv@gmail.com',
  Joel: 'mircommllc@gmail.com'        // recibe el resumen del equipo y los avisos de prospectos calientes vencidos
};
var SEG_MANAGER = 'Joel';
var SEG_APP_URL = 'https://mircommllc.github.io/mircomm-inventory/';
var SEG_CALENDARIO = 'MirComm Seguimiento';
var SEG_ESCALAR_HORAS = 48;           // prospecto caliente con tarea vencida más de estas horas → aviso a Joel
var SEG_AVISO_MIN = 15;               // aviso por correo X minutos antes de una tarea con hora
var SEG_RESUMEN_HORA = 8;             // resumen diario a las 8:30 am

var SEG_INFO_SHEET = 'Seg_Info';
var SEG_TASK_SHEET = 'Seg_Tareas';
var SEG_INFO_HEADERS = ['ProspectoID', 'Etapa', 'Temperatura', 'Compania', 'PagaMes', 'CuandoCambia', 'Decide', 'Cobertura',
  'FuturoFecha', 'MotivoPerdida', 'SinRespuesta', 'PrimerContacto', 'Cerrado', 'Actualizado'];
var SEG_TASK_HEADERS = ['ID', 'ProspectoID', 'Asesora', 'Tipo', 'Fecha', 'Hora', 'Paso', 'Nota', 'Estado', 'Resultado',
  'Creada', 'Hecha', 'EventoCal', 'Avisada', 'Escalada'];
var SEG_SL_SHEET = 'Seg_SinLinea';
var SEG_SL_HEADERS = ['Cuenta', 'Estado', 'Nota', 'Por', 'Fecha'];
var SEG_SL_DIAS = 60;                 // clientes con internet de los últimos 60 días sin línea móvil
var SEG_ETAPAS = ['Nuevo', 'Contactado', 'Interesado', 'Cita', 'Vendido', 'Perdido', 'Futuro'];
var SEG_TIPOS = ['Llamada', 'Mensaje', 'WhatsApp', 'Cita en tienda', 'Visita'];

// ─── INSTALACIÓN ───────────────────────────────────────────────────
function instalarSeguimiento() {
  segSheet_(SEG_INFO_SHEET, SEG_INFO_HEADERS);
  segSheet_(SEG_TASK_SHEET, SEG_TASK_HEADERS);
  segSheet_(SEG_SL_SHEET, SEG_SL_HEADERS);
  PropertiesService.getScriptProperties().setProperty('SEG_CORREOS', JSON.stringify(SEG_CORREOS));
  var cal = segCalendar_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'segRevisar' || f === 'segResumenDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('segRevisar').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('segResumenDiario').timeBased().atHour(SEG_RESUMEN_HORA).nearMinute(30).everyDays(1).create();
  var falta = Object.keys(SEG_CORREOS).filter(function (k) { return !SEG_CORREOS[k]; });
  Logger.log('Seguimiento instalado. Calendario: ' + (cal ? cal.getName() : 'no se pudo crear') +
    (falta.length ? '. Falta correo de: ' + falta.join(', ') : '. Correos listos.'));
}

/** Manda un correo de prueba a cada asesora para confirmar que les llega. */
function probarCorreosSeguimiento() {
  var c = segCorreos_();
  Object.keys(c).forEach(function (n) {
    if (c[n]) segMail_(c[n], '✅ Prueba: avisos de seguimiento de MirComm',
      '<p>Hola ' + segEsc_(n) + ', este es un correo de prueba. Aquí te van a llegar tus seguimientos del día y los recordatorios de tus llamadas.</p>');
  });
}

// ─── ROUTER ────────────────────────────────────────────────────────
// En Code.gs → doGet(e), justo debajo de prosSessionPin_(e):
//   var sg = seguimientoRouter_(e); if (sg) return sg;
function seguimientoRouter_(e) {
  var p = (e && e.parameter) || {};
  var a = String(p.action || '');
  if (a.indexOf('seg') !== 0) return null;
  var out;
  try {
    var me = segAuth_(p);
    if (a === 'segList') out = segList_(me);
    else if (a === 'segInit') out = segLock_(function () { return segInit_(me, p); });
    else if (a === 'segSave') out = segLock_(function () { return segSave_(me, p); });
    else if (a === 'segTask') out = segLock_(function () { return segTask_(me, p); });
    else if (a === 'segDone') out = segLock_(function () { return segDone_(me, p); });
    else if (a === 'segClose') out = segLock_(function () { return segClose_(me, p); });
    else if (a === 'segSinLineaMark') out = segLock_(function () { return segSinLineaMark_(me, p); });
    else if (a === 'segSinLineaSync') out = segLock_(function () { return segSinLineaSync_(me, p); });
    else if (a === 'segIncMark') out = segLock_(function () { return segIncMark_(me, p); });
    else throw new Error('Acción desconocida: ' + a);
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Asesora: usuario + PIN de 6 dígitos (como Prospectos). Joel: su sesión de manager (mt) o su PIN.
function segAuth_(p) {
  if (!p.pin && typeof isManagerToken_ === 'function' && isManagerToken_(p.mt)) return { name: SEG_MANAGER, manager: true };
  if (typeof prosAuth_ !== 'function') throw new Error('Falta Prospectos.gs.');
  var me = prosAuth_(p);
  return { name: me.name, manager: !!me.manager };
}
function segLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ─── HOJAS ─────────────────────────────────────────────────────────
function segSS_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function segSheet_(name, headers) {
  var ss = segSS_(), sh = ss.getSheetByName(name);
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
function segRead_(name, headers) {
  var sh = segSheet_(name, headers);
  var last = sh.getLastRow();
  var hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  var rows = [];
  if (last > 1) {
    sh.getRange(2, 1, last - 1, hdr.length).getValues().forEach(function (r, i) {
      if (r.every(function (v) { return v === '' || v === null; })) return;
      var o = { _row: i + 2 };
      hdr.forEach(function (h, j) { if (h) o[h] = segStr_(r[j]); });
      rows.push(o);
    });
  }
  return { sh: sh, hdr: hdr, rows: rows };
}
function segStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, segTz_(), v.getHours() || v.getMinutes() ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}
function segWrite_(t, obj) {
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
function segClean_(o) { var c = {}; for (var k in o) if (k !== '_row') c[k] = o[k]; return c; }
function segTz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }
function segNow_() { return Utilities.formatDate(new Date(), segTz_(), 'yyyy-MM-dd HH:mm'); }
function segToday_() { return Utilities.formatDate(new Date(), segTz_(), 'yyyy-MM-dd'); }
function segDateOk_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function segTimeOk_(s) { return /^\d{2}:\d{2}$/.test(String(s || '')); }
function segParse_(ymd, hm) {
  var m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/), t = String(hm || '').match(/^(\d{2}):(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], t ? +t[1] : 0, t ? +t[2] : 0) : null;
}
function segEsc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Prospectos (solo lectura, de la hoja de Prospectos.gs)
function segProspects_() {
  var sh = segSS_().getSheetByName('Prospectos'), map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(), h = v[0].map(String);
  for (var i = 1; i < v.length; i++) {
    var o = {};
    h.forEach(function (k, j) { o[k] = segStr_(v[i][j]); });
    if (o.ID) map[o.ID] = o;
  }
  return map;
}

// ─── ACCIONES ──────────────────────────────────────────────────────
function segList_(me) {
  var info = segRead_(SEG_INFO_SHEET, SEG_INFO_HEADERS).rows;
  var tasks = segRead_(SEG_TASK_SHEET, SEG_TASK_HEADERS).rows;
  if (!me.manager) {
    var mine = {};
    tasks = tasks.filter(function (t) { return t.Asesora === me.name; });
    var pros = segProspects_();
    Object.keys(pros).forEach(function (id) { if (pros[id].Asesora === me.name) mine[id] = 1; });
    info = info.filter(function (r) { return mine[r.ProspectoID]; });
  }
  return { ok: true, now: segNow_(), info: info.map(segClean_), tasks: tasks.map(segClean_),
    sinLinea: segSinLinea_(me), incompletas: segIncompletas_(), correos: me.manager ? segCorreos_() : undefined };
}

function segGetProspect_(me, id) {
  var p = segProspects_()[String(id || '')];
  if (!p) throw new Error('No encontré ese prospecto.');
  if (!me.manager && p.Asesora !== me.name) throw new Error('Ese prospecto no es tuyo.');
  return p;
}
function segInfoRow_(t, id) {
  for (var i = 0; i < t.rows.length; i++) if (t.rows[i].ProspectoID === id) return t.rows[i];
  return null;
}
function segApplyQual_(r, p) {
  ['Compania', 'PagaMes', 'CuandoCambia', 'Decide', 'Cobertura'].forEach(function (k) {
    if (p[k] !== undefined) r[k] = String(p[k]).slice(0, 80);
  });
  r.Temperatura = p.Temperatura && /^(Caliente|Tibio|Frío)$/.test(p.Temperatura) ? p.Temperatura : segTemp_(r);
}
// 🔥 Caliente: se puede cambiar ya, decide y hay cobertura. ❄️ Frío: más de 3 meses o sin cobertura.
function segTemp_(r) {
  if (r.Cobertura === 'No' || r.CuandoCambia === 'Más de 3 meses') return 'Frío';
  if (r.CuandoCambia === 'Ya' && r.Decide !== 'No') return 'Caliente';
  return 'Tibio';
}

// Al registrar un prospecto nuevo: crea su ficha de seguimiento y la primera tarea (Día 0: mensaje de bienvenida).
function segInit_(me, p) {
  var pr = segGetProspect_(me, p.id);
  var info = segRead_(SEG_INFO_SHEET, SEG_INFO_HEADERS);
  var r = segInfoRow_(info, pr.ID);
  if (!r) r = { ProspectoID: pr.ID, Etapa: 'Nuevo', SinRespuesta: '0' };
  segApplyQual_(r, p);
  r.Actualizado = segNow_();
  segWrite_(info, r);
  var tasks = segRead_(SEG_TASK_SHEET, SEG_TASK_HEADERS);
  var t = null;
  if (!tasks.rows.some(function (x) { return x.ProspectoID === pr.ID && x.Estado === 'Pendiente'; })) {
    t = segNewTask_(tasks, pr, {
      Tipo: SEG_TIPOS.indexOf(p.tipo) >= 0 ? p.tipo : 'Mensaje',
      Fecha: segDateOk_(p.fecha) ? p.fecha : segToday_(), Hora: segTimeOk_(p.hora) ? p.hora : '',
      Paso: '1', Nota: p.nota || 'Mensaje de bienvenida'
    });
  }
  return { ok: true, info: segClean_(r), task: t ? segClean_(t) : null };
}

// Guarda calificación, etapa o temperatura desde la ficha del prospecto.
function segSave_(me, p) {
  var pr = segGetProspect_(me, p.id);
  var info = segRead_(SEG_INFO_SHEET, SEG_INFO_HEADERS);
  var r = segInfoRow_(info, pr.ID) || { ProspectoID: pr.ID, Etapa: 'Nuevo', SinRespuesta: '0' };
  segApplyQual_(r, p);
  if (p.Etapa && SEG_ETAPAS.indexOf(p.Etapa) >= 0 && ['Vendido', 'Perdido', 'Futuro'].indexOf(p.Etapa) < 0) r.Etapa = p.Etapa;
  r.Actualizado = segNow_();
  segWrite_(info, r);
  return { ok: true, info: segClean_(r) };
}

// Crea, cambia de fecha/hora o cancela una tarea.
function segTask_(me, p) {
  var tasks = segRead_(SEG_TASK_SHEET, SEG_TASK_HEADERS);
  if (p.taskId) {
    var t = tasks.rows.filter(function (x) { return x.ID === p.taskId; })[0];
    if (!t) throw new Error('No encontré esa tarea.');
    if (!me.manager && t.Asesora !== me.name) throw new Error('Esa tarea no es tuya.');
    if (p.cancel === '1') {
      var others = tasks.rows.filter(function (x) { return x.ProspectoID === t.ProspectoID && x.Estado === 'Pendiente' && x.ID !== t.ID; });
      var pr0 = segProspects_()[t.ProspectoID];
      if (!others.length && pr0 && ['Vendido', 'Perdido'].indexOf(pr0.Estado) < 0)
        throw new Error('Cada prospecto necesita un siguiente paso. Cambia la fecha en lugar de cancelar, o ciérralo como perdido.');
      t.Estado = 'Cancelada'; t.Hecha = segNow_();
      segCalDelete_(t);
    } else {
      if (p.fecha) { if (!segDateOk_(p.fecha)) throw new Error('Fecha no válida.'); t.Fecha = p.fecha; }
      if (p.hora !== undefined) t.Hora = segTimeOk_(p.hora) ? p.hora : '';
      if (p.tipo && SEG_TIPOS.indexOf(p.tipo) >= 0) t.Tipo = p.tipo;
      if (p.nota !== undefined) t.Nota = String(p.nota).slice(0, 300);
      t.Avisada = ''; t.Escalada = '';
      segCalSync_(t, segProspects_()[t.ProspectoID]);
    }
    segWrite_(tasks, t);
    return { ok: true, task: segClean_(t) };
  }
  var pr = segGetProspect_(me, p.id);
  if (!segDateOk_(p.fecha)) throw new Error('Elige la fecha del seguimiento.');
  var nt = segNewTask_(tasks, pr, { Tipo: SEG_TIPOS.indexOf(p.tipo) >= 0 ? p.tipo : 'Llamada', Fecha: p.fecha,
    Hora: segTimeOk_(p.hora) ? p.hora : '', Paso: p.paso || '', Nota: p.nota || '' });
  return { ok: true, task: segClean_(nt) };
}

function segNewTask_(tasks, pr, o) {
  var t = {
    ID: 'T' + new Date().getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36),
    ProspectoID: pr.ID, Asesora: pr.Asesora, Tipo: o.Tipo, Fecha: o.Fecha, Hora: o.Hora || '', Paso: o.Paso || '',
    Nota: String(o.Nota || '').slice(0, 300), Estado: 'Pendiente', Resultado: '', Creada: segNow_(), Hecha: '',
    EventoCal: '', Avisada: '', Escalada: ''
  };
  segCalSync_(t, pr);
  segWrite_(tasks, t);
  return t;
}

/**
 * Registrar resultado: cierra las tareas pendientes del prospecto y exige el siguiente paso.
 * p.resultado, p.contesto ('1'/'0'), p.etapa (opcional)
 * Siguiente paso: p.nextTipo + p.nextFecha (+ p.nextHora) — o p.cerrar = 'Perdido' (p.motivo) / 'Futuro' (p.futuro).
 */
function segDone_(me, p) {
  var pr = segGetProspect_(me, p.id);
  var tasks = segRead_(SEG_TASK_SHEET, SEG_TASK_HEADERS);
  var info = segRead_(SEG_INFO_SHEET, SEG_INFO_HEADERS);
  var r = segInfoRow_(info, pr.ID) || { ProspectoID: pr.ID, Etapa: 'Nuevo', SinRespuesta: '0' };
  var cerrar = String(p.cerrar || '');
  if (!cerrar && !segDateOk_(p.nextFecha)) throw new Error('Agenda el siguiente paso (fecha) o cierra el prospecto.');
  if (cerrar === 'Perdido' && !p.motivo) throw new Error('Escribe el motivo de la pérdida.');
  if (cerrar === 'Futuro' && !segDateOk_(p.futuro)) throw new Error('Elige la fecha para volver a contactarlo.');

  var now = segNow_();
  tasks.rows.forEach(function (t) {
    if (t.ProspectoID === pr.ID && t.Estado === 'Pendiente') {
      t.Estado = 'Hecha'; t.Hecha = now; t.Resultado = String(p.resultado || '').slice(0, 120);
      segCalDelete_(t);
      segWrite_(tasks, t);
    }
  });

  var contesto = p.contesto === '1';
  r.SinRespuesta = contesto ? '0' : String((+r.SinRespuesta || 0) + 1);
  if (!r.PrimerContacto) r.PrimerContacto = now;
  if (contesto && r.Etapa === 'Nuevo') r.Etapa = 'Contactado';
  if (p.etapa && ['Contactado', 'Interesado', 'Cita'].indexOf(p.etapa) >= 0 &&
      SEG_ETAPAS.indexOf(p.etapa) > SEG_ETAPAS.indexOf(r.Etapa === 'Futuro' ? 'Nuevo' : r.Etapa)) r.Etapa = p.etapa;
  if (r.Etapa === 'Futuro' && contesto) r.Etapa = p.etapa || 'Contactado';
  if (p.Temperatura || p.CuandoCambia !== undefined) segApplyQual_(r, p);

  var next = null;
  if (cerrar === 'Perdido') { r.Etapa = 'Perdido'; r.MotivoPerdida = String(p.motivo).slice(0, 120); r.Cerrado = now; }
  else if (cerrar === 'Futuro') {
    r.Etapa = 'Futuro'; r.FuturoFecha = p.futuro;
    next = segNewTask_(tasks, pr, { Tipo: 'Llamada', Fecha: p.futuro, Hora: '', Paso: '', Nota: 'Volver a contactar: ' + (p.motivo || p.resultado || '') });
  } else {
    var tipo = SEG_TIPOS.indexOf(p.nextTipo) >= 0 ? p.nextTipo : 'Llamada';
    if (tipo === 'Cita en tienda' && ['Nuevo', 'Contactado', 'Interesado'].indexOf(r.Etapa) >= 0) r.Etapa = 'Cita';
    next = segNewTask_(tasks, pr, { Tipo: tipo, Fecha: p.nextFecha, Hora: segTimeOk_(p.nextHora) ? p.nextHora : '',
      Paso: p.nextPaso || '', Nota: p.nextNota || '' });
  }
  r.Actualizado = now;
  segWrite_(info, r);
  return { ok: true, info: segClean_(r), next: next ? segClean_(next) : null };
}

// Cierre desde fuera del registro de resultado (p.ej. "Se vendió" o el cruce con Activaciones).
function segClose_(me, p) {
  var pr = segGetProspect_(me, p.id);
  var etapa = p.etapa === 'Perdido' ? 'Perdido' : 'Vendido';
  var tasks = segRead_(SEG_TASK_SHEET, SEG_TASK_HEADERS), now = segNow_();
  tasks.rows.forEach(function (t) {
    if (t.ProspectoID === pr.ID && t.Estado === 'Pendiente') {
      t.Estado = 'Cancelada'; t.Hecha = now; t.Resultado = etapa; segCalDelete_(t); segWrite_(tasks, t);
    }
  });
  var info = segRead_(SEG_INFO_SHEET, SEG_INFO_HEADERS);
  var r = segInfoRow_(info, pr.ID) || { ProspectoID: pr.ID, SinRespuesta: '0' };
  r.Etapa = etapa; r.Cerrado = now; r.Actualizado = now;
  if (etapa === 'Perdido') r.MotivoPerdida = String(p.motivo || r.MotivoPerdida || '').slice(0, 120);
  segWrite_(info, r);
  return { ok: true, info: segClean_(r) };
}

// ─── GOOGLE CALENDAR ───────────────────────────────────────────────
function segCalendar_() {
  try {
    var c = CalendarApp.getCalendarsByName(SEG_CALENDARIO);
    return c && c.length ? c[0] : CalendarApp.createCalendar(SEG_CALENDARIO, { color: CalendarApp.Color.CYAN });
  } catch (e) { return null; }
}
// Solo las tareas con hora van al calendario (las de solo fecha salen en el resumen diario).
function segCalSync_(t, pr) {
  try {
    var cal = segCalendar_();
    if (!cal) return;
    if (t.EventoCal) { var old = cal.getEventById(t.EventoCal); if (old) old.deleteEvent(); t.EventoCal = ''; }
    if (!t.Hora || t.Estado !== 'Pendiente') return;
    var start = segParse_(t.Fecha, t.Hora);
    var end = new Date(start.getTime() + (t.Tipo === 'Cita en tienda' ? 30 : 15) * 60000);
    var email = segCorreos_()[t.Asesora];
    var nombre = pr ? pr.Nombre : '', tel = pr ? String(pr.Telefono || '') : '';
    var ev = cal.createEvent(segIcon_(t.Tipo) + ' ' + t.Tipo + ': ' + nombre + ' · MirComm', start, end, {
      description: 'Teléfono: ' + segFmtPhone_(tel) + (t.Nota ? '\n' + t.Nota : '') + '\n\nRegistra el resultado en el app: ' + SEG_APP_URL,
      location: t.Tipo === 'Cita en tienda' ? 'MirComm, 4415 N. Conway Ave. Ste. 180, Palmhurst, TX 78573' : '',
      guests: email || '', sendInvites: !!email
    });
    ev.removeAllReminders();
    ev.addPopupReminder(SEG_AVISO_MIN);
    t.EventoCal = ev.getId();
  } catch (e) { /* el calendario es opcional: si falla, la tarea queda igual */ }
}
function segCalDelete_(t) {
  if (!t.EventoCal) return;
  try { var cal = segCalendar_(), ev = cal && cal.getEventById(t.EventoCal); if (ev) ev.deleteEvent(); } catch (e) {}
  t.EventoCal = '';
}

// ─── CORREOS ───────────────────────────────────────────────────────
function segCorreos_() {
  var raw = PropertiesService.getScriptProperties().getProperty('SEG_CORREOS');
  return raw ? JSON.parse(raw) : SEG_CORREOS;
}
function segMail_(to, subject, html) {
  if (!to) return;
  MailApp.sendEmail({ to: to, subject: subject, name: 'MirComm Store Hub',
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0A1F3C;max-width:640px">' + html +
      '<p style="margin-top:22px"><a href="' + SEG_APP_URL + '" style="background:#00D4FF;color:#0A1F3C;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir Store Hub</a></p></div>' });
}
function segIcon_(tipo) { return { 'Llamada': '📞', 'Mensaje': '💬', 'WhatsApp': '🟢', 'Cita en tienda': '🏪', 'Visita': '🚗' }[tipo] || '•'; }
function segTempIcon_(t) { return { 'Caliente': '🔥', 'Tibio': '🌤', 'Frío': '❄️' }[t] || ''; }
function segFmtPhone_(s) { var d = String(s || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : s; }
function segTaskRow_(t, pr, inf, showRep) {
  var tel = pr ? String(pr.Telefono || '').replace(/\D/g, '').slice(-10) : '';
  return '<tr><td style="padding:6px 8px;border-bottom:1px solid #e3e8f0;white-space:nowrap">' + segEsc_(t.Fecha.slice(5)) + (t.Hora ? ' ' + segEsc_(t.Hora) : '') + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #e3e8f0">' + segIcon_(t.Tipo) + ' ' + segEsc_(t.Tipo) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #e3e8f0"><b>' + segEsc_(pr ? pr.Nombre : t.ProspectoID) + '</b> ' + segTempIcon_(inf && inf.Temperatura) +
    (tel ? '<br><a href="tel:+1' + tel + '">' + segFmtPhone_(tel) + '</a>' : '') + (t.Nota ? '<br><span style="color:#5b6b85">' + segEsc_(t.Nota) + '</span>' : '') + '</td>' +
    (showRep ? '<td style="padding:6px 8px;border-bottom:1px solid #e3e8f0">' + segEsc_(t.Asesora) + '</td>' : '') + '</tr>';
}
function segTable_(rows, showRep) {
  return '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="background:#0A1F3C;color:#fff">' +
    '<th align="left" style="padding:6px 8px">Cuándo</th><th align="left" style="padding:6px 8px">Qué</th><th align="left" style="padding:6px 8px">Prospecto</th>' +
    (showRep ? '<th align="left" style="padding:6px 8px">Asesora</th>' : '') + '</tr>' + rows.join('') + '</table>';
}
function segOpenTasks_() {
  var pros = segProspects_();
  var info = {}; segRead_(SEG_INFO_SHEET, SEG_INFO_HEADERS).rows.forEach(function (r) { info[r.ProspectoID] = r; });
  var tasks = segRead_(SEG_TASK_SHEET, SEG_TASK_HEADERS);
  var open = tasks.rows.filter(function (t) {
    var pr = pros[t.ProspectoID];
    return t.Estado === 'Pendiente' && pr && ['Vendido', 'Perdido'].indexOf(pr.Estado) < 0;
  });
  return { pros: pros, info: info, tasks: tasks, open: open };
}

// Cada 15 minutos: aviso antes de cada tarea con hora + aviso a Joel de prospectos calientes vencidos.
function segRevisar() {
  var d = segOpenTasks_(), now = new Date(), correos = segCorreos_(), hot = [];
  d.open.forEach(function (t) {
    var pr = d.pros[t.ProspectoID], inf = d.info[t.ProspectoID] || {};
    if (t.Hora && !t.Avisada) {
      var start = segParse_(t.Fecha, t.Hora), mins = (start - now) / 60000;
      if (mins <= SEG_AVISO_MIN + 7 && mins > -30) {
        segMail_(correos[t.Asesora], '⏰ ' + t.Hora + ' · ' + t.Tipo + ' con ' + (pr ? pr.Nombre : ''),
          '<p>' + segEsc_(t.Asesora) + ', en unos minutos tienes este seguimiento:</p>' + segTable_([segTaskRow_(t, pr, inf, false)], false) +
          '<p>Cuando termines, registra el resultado y agenda el siguiente paso.</p>');
        t.Avisada = segNow_(); segWrite_(d.tasks, t);
      }
    }
    if (!t.Escalada && inf.Temperatura === 'Caliente') {
      var due = segParse_(t.Fecha, t.Hora || '23:59');
      if ((now - due) / 3600000 >= SEG_ESCALAR_HORAS) { hot.push(t); t.Escalada = segNow_(); segWrite_(d.tasks, t); }
    }
  });
  try { segAvisarIncompletas_(); } catch (e) { Logger.log('Incompletas: ' + e.message); }
  if (hot.length) {
    segMail_(correos[SEG_MANAGER], '🔥 ' + hot.length + ' prospecto(s) caliente(s) sin seguimiento',
      '<p>Estos prospectos calientes tienen su seguimiento vencido hace más de ' + SEG_ESCALAR_HORAS + ' horas:</p>' +
      segTable_(hot.map(function (t) { return segTaskRow_(t, d.pros[t.ProspectoID], d.info[t.ProspectoID], true); }), true));
  }
}

// Diario 8:30 am: a cada asesora sus vencidos + los de hoy; a Joel el resumen del equipo.
function segResumenDiario() {
  var d = segOpenTasks_(), today = segToday_(), correos = segCorreos_();
  var sortT = function (a, b) { return (a.Fecha + (a.Hora || '99')).localeCompare(b.Fecha + (b.Hora || '99')); };
  var row = function (t, rep) { return segTaskRow_(t, d.pros[t.ProspectoID], d.info[t.ProspectoID], rep); };
  var team = [];
  var reps = {};
  d.open.forEach(function (t) { (reps[t.Asesora] = reps[t.Asesora] || []).push(t); });
  Object.keys(correos).forEach(function (rep) { if (rep !== SEG_MANAGER && !reps[rep] && !(typeof staffEsBaja_ === 'function' && staffEsBaja_(rep))) reps[rep] = []; });   // v62.1: sin bajas (👥 Equipo)
  Object.keys(reps).forEach(function (rep) {
    var list = reps[rep];
    var late = list.filter(function (t) { return t.Fecha < today; }).sort(sortT);
    var now = list.filter(function (t) { return t.Fecha === today; }).sort(sortT);
    team.push({ rep: rep, late: late.length, today: now.length });
    if (rep === SEG_MANAGER || !correos[rep] || (!late.length && !now.length)) return;
    segMail_(correos[rep], '📋 Tus seguimientos de hoy: ' + now.length + (late.length ? ' · ⚠️ ' + late.length + ' vencido(s)' : ''),
      '<p>Buenos días, ' + segEsc_(rep) + '.</p>' +
      (late.length ? '<h3 style="color:#c0392b;margin:16px 0 6px">⚠️ Vencidos (' + late.length + ')</h3>' + segTable_(late.map(function (t) { return row(t, false); }), false) : '') +
      (now.length ? '<h3 style="margin:16px 0 6px">📅 Para hoy (' + now.length + ')</h3>' + segTable_(now.map(function (t) { return row(t, false); }), false) : '') +
      '<p style="color:#5b6b85">Cada prospecto que registraste es una venta posible. Registra cada resultado y agenda el siguiente paso.</p>');
  });
  var mgr = correos[SEG_MANAGER];
  if (mgr && d.open.length) {
    var late = d.open.filter(function (t) { return t.Fecha < today; }).sort(sortT);
    segMail_(mgr, '📊 Seguimiento del equipo hoy',
      '<table style="border-collapse:collapse;font-size:14px">' + team.filter(function (x) { return x.rep !== SEG_MANAGER || x.late || x.today; }).map(function (x) {
        return '<tr><td style="padding:4px 12px 4px 0"><b>' + segEsc_(x.rep) + '</b></td><td style="padding:4px 12px">' + x.today + ' para hoy</td>' +
          '<td style="padding:4px 12px;color:' + (x.late ? '#c0392b' : '#27ae60') + '">' + x.late + ' vencido(s)</td></tr>';
      }).join('') + '</table>' +
      (late.length ? '<h3 style="color:#c0392b;margin:16px 0 6px">Vencidos</h3>' + segTable_(late.map(function (t) { return row(t, true); }), true) : ''));
  }
}

