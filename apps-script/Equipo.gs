/**
 * Equipo.gs — 👥 Equipo del Hub de MirComm (v62)
 * -----------------------------------------------------------------------------
 * Una ficha por persona con todo su historial en MirComm:
 *   - PERIODOS: cada vez que alguien entra es un periodo nuevo (un reingreso no borra el anterior).
 *     Ej.: Lizbeth salió en junio de 2026 y regresó el 12 oct 2026 → Periodo 1 (cerrado) y Periodo 2 (activo).
 *   - ALTA con checklist de entrada (I-9, W-4, ID, carta de oferta, depósito directo, confidencialidad, reglas)
 *     y accesos (PIN del Hub, correo mircommusa.com, Connecteam, Rep ID de Spectrum).
 *   - BAJA y REINGRESO desde la ficha. La baja apaga el PIN de 6 dígitos (el día después de la fecha de salida)
 *     y el reingreso lo vuelve a prender. Reemplaza a STAFF_BAJAS (Prospectos.gs) y HUB_BAJAS (index.html).
 *   - CONSTANCIA DE SALIDA guardada en la ficha (ya no en el navegador). Las firmas van como imagen a Drive.
 *   - DOCUMENTOS en una carpeta PRIVADA de Drive por persona y por periodo. Los I-9 van aparte, en su propia
 *     carpeta "I-9 (aparte)". En la hoja nunca se guarda el número de Seguro Social ni números de cuenta:
 *     esos solo viven en las fotos/PDF dentro de Drive.
 *   - LINK DE ALTA: un link firmado (vence en 7 días) para que la persona llene sus datos desde su teléfono,
 *     suba fotos de sus papeles y firme las reglas y la confidencialidad en la pantalla.
 *   - ELEGIBLE PARA RECONTRATAR (Sí / Con reservas / No) en cada baja.
 *
 * Hojas (se crean solas en la hoja del Hub): Equipo, Equipo_Periodos, Equipo_Docs.
 * La primera vez se llenan solas con Lizbeth y Alondra (y cualquier otra asesora que esté en PROSPECTOS_CONFIG).
 *
 * Usa: isManagerToken_ (Activaciones.gs), adminMe_ (Admins.gs, opcional), PROSPECTOS_CONFIG (Prospectos.gs),
 *      STAFF_BAJAS (Prospectos.gs, solo para llenar la hoja la primera vez), SPREADSHEET_ID (Code.gs).
 *
 * INSTALAR (una vez):
 *  1. Apps Script del Hub: ＋ → Script → nómbralo "Equipo" → pega todo este archivo → Guardar.
 *     Pega también la versión nueva de Prospectos.gs (staffEsBaja_ ya pregunta a Equipo).
 *  2. En Code.gs pega esta línea en DOS lugares:
 *        var eq = equipoRouter_(e); if (eq) return eq;
 *     a) dentro de function hubGet_(e), JUSTO DEBAJO de  prosSessionPin_(e);
 *     b) dentro de function hubPost_(e) (Code.gs; doPost la llama vía adminHandle_), como PRIMERA línea (el Hub manda las acciones de Equipo por POST,
 *        porque los documentos y las firmas no caben en un GET). El router revisa el PIN por su cuenta.
 *  3. En la barra de arriba escoge la función  instalarEquipo  → ▶ Ejecutar → acepta los permisos
 *     (pide Drive para las carpetas privadas). Crea las hojas, la carpeta "MirComm · Equipo (privado)" y llena las fichas.
 *  4. Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 */

// ─── CONFIGURACIÓN ─────────────────────────────────────────────────
var EQ_SHEET = 'Equipo';
var EQ_HEADERS = ['ID', 'Usuario', 'NombreCompleto', 'Genero', 'Rol', 'Telefono', 'CorreoPersonal', 'CorreoEmpresa', 'Direccion',
  'Emergencia', 'Codigo', 'RepIds', 'Connecteam', 'Recontratar', 'RecontratarNota', 'CarpetaId', 'Notas', 'Creado', 'Actualizado'];
var EQ_PER_SHEET = 'Equipo_Periodos';
var EQ_PER_HEADERS = ['ID', 'PersonaID', 'Num', 'Estado', 'Puesto', 'Ingreso', 'Salida', 'Pago', 'TipoSalida', 'Motivo',
  'Entrada', 'Accesos', 'Constancia', 'CarpetaId', 'Notas', 'Creado', 'Actualizado'];
var EQ_DOC_SHEET = 'Equipo_Docs';
var EQ_DOC_HEADERS = ['ID', 'PersonaID', 'PeriodoID', 'Tipo', 'Nombre', 'ArchivoID', 'Url', 'Vence', 'Fuente', 'Subido', 'Por', 'Nota'];
var EQ_ROOT_NAME = 'MirComm · Equipo (privado)';
var EQ_I9_NAME = 'I-9 (aparte)';
var EQ_LINK_DIAS = 7;
var EQ_MAX_B64 = 14000000;   // ~10 MB por archivo
var EQ_TIPOS = {
  i9: 'Formulario I-9', w4: 'W-4', id: 'Identificación', oferta: 'Carta de oferta', deposito: 'Depósito directo',
  confidencialidad: 'Acuerdo de confidencialidad', reglas: 'Reglas de la tienda', constancia: 'Constancia de salida',
  firma: 'Firma', otro: 'Otro documento'
};
var EQ_CHECK_KEYS = ['i9', 'w4', 'id', 'oferta', 'deposito', 'confidencialidad', 'reglas'];
var EQ_ACC_KEYS = ['pin', 'correo', 'connecteam', 'repId'];
var EQ_RECONTRATAR = ['', 'Sí', 'Con reservas', 'No'];
var EQ_ACTIONS = { eqList: 1, eqSave: 1, eqAlta: 1, eqBaja: 1, eqPeriodo: 1, eqPin: 1, eqDocUp: 1, eqDocEdit: 1, eqDocDel: 1,
  eqConstGet: 1, eqConstSave: 1, eqLink: 1, eqTextos: 1, eqTextosSave: 1 };

// Fichas iniciales (solo la primera vez, si la hoja Equipo está vacía)
var EQ_SEED = [
  { usuario: 'Lizbeth', nombre: 'Lizbeth Baltazar', genero: 'f', rol: 'rep', periodos: [
    { puesto: 'Sales Representative', ingreso: '', salida: '', estado: 'Cerrado', notas: 'Salió en junio de 2026. Falta poner las fechas exactas de este periodo.' },
    { puesto: 'Sales Representative', ingreso: '2026-10-12', salida: '', estado: 'Abierto', notas: 'Reingreso.' }
  ] },
  { usuario: 'Alondra', nombre: 'Alondra Soria Baldomero', genero: 'f', rol: 'rep', periodos: [
    { puesto: 'Sales Representative', ingreso: '2026-06-04', salida: '2026-10-31', estado: 'Cerrado', notas: '',
      constancia: { nombre: 'Alondra Soria Baldomero', genero: 'f', puesto: 'Sales Representative', ingreso: '2026-06-04',
        salida: '2026-10-31', repId: 'CMMLB4898', pagoFecha: '2026-10-31', pagoMetodo: 'cheque', pagoBanco: 'Chase Bank',
        pagoNum: '1253', pagoMonto: '224.13' } }
  ] }
];

// Textos que la persona firma desde el link de alta (se pueden cambiar desde 👥 Equipo → ⚙ Textos del alta)
var EQ_TEXTOS_DEF = {
  reglasEs: 'REGLAS DE LA TIENDA · MirComm LLC\n\n' +
    '1. Llego a tiempo y marco mi entrada y salida en Connecteam. Si voy a faltar o a llegar tarde, le aviso a Joel antes.\n' +
    '2. Entro al Hub solo con mi PIN. No se lo doy a nadie y no uso el de otra persona.\n' +
    '3. Toda venta, cobro y recibo se registra en el Hub en el momento. El efectivo se cuenta y se entrega como me indiquen.\n' +
    '4. Las líneas y servicios se activan solo con datos reales del cliente y con su permiso. Nunca cuentas inventadas ni datos de otra persona.\n' +
    '5. Trato a cada cliente con respeto, en el idioma que prefiera, y no le prometo lo que no podemos cumplir.\n' +
    '6. Teléfonos, SIMs, equipo de muestra, llaves y papeles de la tienda son de MirComm y no salen de la tienda sin permiso.\n' +
    '7. Mi celular personal no lo uso frente al cliente, salvo para el trabajo.\n' +
    '8. Cualquier problema con un cliente, una orden, el dinero o el inventario se lo reporto a Joel el mismo día.',
  reglasEn: 'STORE RULES · MirComm LLC\n\n' +
    '1. I arrive on time and clock in and out in Connecteam. If I will be absent or late, I tell Joel beforehand.\n' +
    '2. I log in to the Hub only with my own PIN. I never share it and never use anyone else\'s.\n' +
    '3. Every sale, payment and receipt is recorded in the Hub at the moment it happens. Cash is counted and handed in as instructed.\n' +
    '4. Lines and services are activated only with the customer\'s real information and consent. Never made-up accounts or someone else\'s data.\n' +
    '5. I treat every customer with respect, in the language they prefer, and never promise what we cannot deliver.\n' +
    '6. Phones, SIM cards, demo units, keys and store paperwork belong to MirComm and do not leave the store without permission.\n' +
    '7. I do not use my personal phone in front of customers except for work.\n' +
    '8. I report any problem with a customer, an order, cash or inventory to Joel the same day.',
  confEs: 'ACUERDO DE CONFIDENCIALIDAD · MirComm LLC\n\n' +
    '1. La información de los clientes (nombres, teléfonos, direcciones, números y PINs de cuenta, identificaciones) es confidencial. Solo la uso para atender al cliente; no la copio, no le tomo foto y no la comparto fuera de MirComm.\n' +
    '2. Mis contraseñas y accesos (Spectrum, AT&T, Cellmart, Hub, correo y cualquier otro portal) son personales y no los comparto.\n' +
    '3. Precios, comisiones, reportes, listas de clientes y prospectos, y cualquier información del negocio son de MirComm.\n' +
    '4. Al terminar mi trabajo en MirComm devuelvo todo el material y equipo, y esta obligación de confidencialidad sigue vigente.\n' +
    '5. Si me entero de que alguien usó información de un cliente sin permiso, le aviso a Joel de inmediato.',
  confEn: 'CONFIDENTIALITY AGREEMENT · MirComm LLC\n\n' +
    '1. Customer information (names, phone numbers, addresses, account numbers and PINs, IDs) is confidential. I use it only to serve the customer; I do not copy it, photograph it or share it outside MirComm.\n' +
    '2. My passwords and access (Spectrum, AT&T, Cellmart, the Hub, email and any other portal) are personal and I do not share them.\n' +
    '3. Prices, commissions, reports, customer and prospect lists, and any business information belong to MirComm.\n' +
    '4. When my work at MirComm ends I return all materials and equipment, and this confidentiality obligation continues.\n' +
    '5. If I learn that someone used customer information without permission, I tell Joel immediately.'
};

// ─── INSTALAR (correr una vez desde el editor) ──────────────────────
function instalarEquipo() {
  eqLock_(function () {
    eqT_('p'); eqT_('pe'); eqT_('d');
    eqSeed_();
    eqRoot_(); eqI9_();
  });
  eqCacheClear_();
  Logger.log('Equipo listo. Carpeta privada: ' + eqRoot_().getUrl());
}

// ─── ROUTER ────────────────────────────────────────────────────────
// En Code.gs → hubGet_(e), justo debajo de prosSessionPin_(e), Y como primera línea de hubPost_(e):
//   var eq = equipoRouter_(e); if (eq) return eq;
function equipoRouter_(e) {
  var p = {}, src = (e && e.parameter) || {};
  for (var k in src) p[k] = src[k];
  if (e && e.postData && e.postData.contents) {
    try { var b = JSON.parse(e.postData.contents); for (var j in b) p[j] = b[j]; } catch (x) {}
  }
  var a = String(p.action || '');
  if (a === 'eqForm') return eqFormPage_(p);            // link de alta (sin PIN; va firmado y vence)
  if (a === 'eqTeam') return eqJson_(eqTeamPublic_()); // nombres para la pantalla de entrada (sin PIN)
  if (!EQ_ACTIONS[a]) return null;
  eqAuditLabels_();
  var out;
  try {
    if (!(typeof isManagerToken_ === 'function' && isManagerToken_(p.mt))) {
      out = { error: 'Tu sesión venció. Entra otra vez con tu PIN.', code: 'AUTH' };
    } else {
      var d = eqData_(p.data);
      if (a === 'eqList') out = eqLock_(function () { return eqList_(); });
      else if (a === 'eqConstGet') out = eqConstGet_(d);
      else if (a === 'eqTextos') out = { ok: true, textos: eqTextos_() };
      else out = eqLock_(function () {
        var r;
        if (a === 'eqSave') r = eqSave_(d);
        else if (a === 'eqAlta') r = eqAlta_(d);
        else if (a === 'eqBaja') r = eqBaja_(d);
        else if (a === 'eqPeriodo') r = eqPeriodo_(d);
        else if (a === 'eqPin') r = eqPin_(d);
        else if (a === 'eqDocUp') r = eqDocUp_(d);
        else if (a === 'eqDocEdit') r = eqDocEdit_(d);
        else if (a === 'eqDocDel') r = eqDocDel_(d);
        else if (a === 'eqConstSave') r = eqConstSave_(d);
        else if (a === 'eqLink') r = eqLink_(d);
        else if (a === 'eqTextosSave') r = eqTextosSave_(d);
        eqCacheClear_();
        return r;
      });
    }
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return eqJson_(out);
}
function eqJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function eqData_(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)) || {}; } catch (e) { return {}; }
}
function eqLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function eqAuditLabels_() {
  try {
    if (typeof AUD_LABELS === 'object' && AUD_LABELS) {
      AUD_LABELS.eqSave = 'Equipo: cambió datos de la ficha';
      AUD_LABELS.eqAlta = 'Equipo: alta o reingreso';
      AUD_LABELS.eqBaja = 'Equipo: baja';
      AUD_LABELS.eqPeriodo = 'Equipo: actualizó periodo / checklist';
      AUD_LABELS.eqPin = 'Equipo: cambió PIN';
      AUD_LABELS.eqDocUp = 'Equipo: subió documento';
      AUD_LABELS.eqDocEdit = 'Equipo: editó documento';
      AUD_LABELS.eqDocDel = 'Equipo: quitó documento';
      AUD_LABELS.eqConstSave = 'Equipo: constancia de salida';
      AUD_LABELS.eqLink = 'Equipo: generó link de alta';
      AUD_LABELS.eqTextosSave = 'Equipo: cambió textos del alta';
    }
  } catch (e) {}
}
function eqWho_() { try { return typeof adminMe_ === 'function' ? (adminMe_() || 'Joel') : 'Joel'; } catch (e) { return 'Joel'; } }

// ─── UTILIDADES ────────────────────────────────────────────────────
function eqTz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }
function eqToday_() { return Utilities.formatDate(new Date(), eqTz_(), 'yyyy-MM-dd'); }
function eqNow_() { return Utilities.formatDate(new Date(), eqTz_(), 'yyyy-MM-dd HH:mm'); }
function eqAddDays_(ymd, n) {
  var d = new Date(String(ymd).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, eqTz_(), 'yyyy-MM-dd');
}
function eqYmd_(v) { var s = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function eqStr_(v, max) { var s = v === null || v === undefined ? '' : String(v).trim(); return max ? s.slice(0, max) : s; }
function eqDigits_(v) { return String(v || '').replace(/\D/g, ''); }
function eqPhone_(v) {
  var d = eqDigits_(v); if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : eqStr_(v, 40);
}
function eqJ_(s) { if (!s) return {}; try { var o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function eqEsc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function eqNorm_(s) {
  var map = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n' };
  return String(s || '').toLowerCase().replace(/[áéíóúüñ]/g, function (c) { return map[c]; }).replace(/\s+/g, ' ').trim();
}
function eqRepList_(v) {
  var out = [];
  (Object.prototype.toString.call(v) === '[object Array]' ? v : String(v || '').split(/[,;\s]+/)).forEach(function (x) {
    x = String(x || '').trim().toUpperCase(); if (x && out.indexOf(x) < 0) out.push(x);
  });
  return out;
}
// SSN en un campo de texto: no se guarda (se quita y se avisa)
function eqNoSsn_(s) { return String(s || '').replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, '[quitado]'); }

// ─── HOJAS ─────────────────────────────────────────────────────────
function eqSS_() {
  var id = (typeof SPREADSHEET_ID !== 'undefined' && SPREADSHEET_ID) ? SPREADSHEET_ID : '1fYPIQh0j_deGwJ_vj1EG5gWOn1oYX5eiVzW0xqt-fgM';
  return SpreadsheetApp.openById(id);
}
function eqSheet_(name, headers) {
  var ss = eqSS_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
  if (missing.length) {
    var c = have.filter(String).length + 1;
    sh.getRange(1, c, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sh.getRange(2, c, Math.max(sh.getMaxRows() - 1, 1), missing.length).setNumberFormat('@');
  }
  return sh;
}
// t = 'p' (personas), 'pe' (periodos), 'd' (documentos)
function eqT_(t) {
  var name = t === 'p' ? EQ_SHEET : t === 'pe' ? EQ_PER_SHEET : EQ_DOC_SHEET;
  var hd = t === 'p' ? EQ_HEADERS : t === 'pe' ? EQ_PER_HEADERS : EQ_DOC_HEADERS;
  var sh = eqSheet_(name, hd), lr = sh.getLastRow(), lc = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lc).getValues()[0].map(String), rows = [];
  if (lr > 1) {
    sh.getRange(2, 1, lr - 1, lc).getDisplayValues().forEach(function (v, i) {
      var o = { _row: i + 2 };
      headers.forEach(function (h, j) { if (h) o[h] = v[j]; });
      if (o.ID) rows.push(o);
    });
  }
  return { sh: sh, headers: headers, rows: rows };
}
function eqWrite_(tb, obj) {
  var vals = tb.headers.map(function (h) { return h && obj[h] !== undefined && obj[h] !== null ? String(obj[h]) : ''; });
  if (!obj._row) {
    obj._row = Math.max(tb.sh.getLastRow(), 1) + 1;
    tb.rows.push(obj);
  }
  tb.sh.getRange(obj._row, 1, 1, vals.length).setNumberFormat('@').setValues([vals]);
}
function eqDelRow_(tb, obj) {
  tb.sh.deleteRow(obj._row);
  tb.rows = tb.rows.filter(function (r) { return r !== obj; });
  tb.rows.forEach(function (r) { if (r._row > obj._row) r._row--; });
}
function eqNextId_(rows, prefix, width) {
  var max = 0;
  rows.forEach(function (r) { var m = String(r.ID).match(/(\d+)$/); if (m && +m[1] > max) max = +m[1]; });
  var n = String(max + 1); while (n.length < width) n = '0' + n;
  return prefix + n;
}
function eqById_(tb, id) {
  for (var i = 0; i < tb.rows.length; i++) if (tb.rows[i].ID === id) return tb.rows[i];
  return null;
}
function eqPeriodsOf_(tpe, personaId) {
  return tpe.rows.filter(function (r) { return r.PersonaID === personaId; })
    .sort(function (a, b) { return (+a.Num || 0) - (+b.Num || 0); });
}

// ─── ESTADO DE CADA PERSONA ────────────────────────────────────────
// activo · saliendo (ya tiene fecha de salida, pero todavía no pasa) · baja · pendiente (sin periodos)
function eqEstado_(pers, hoy) {
  var last = pers[pers.length - 1];
  if (!last) return 'pendiente';
  if (last.Estado !== 'Cerrado') return last.Ingreso && last.Ingreso > hoy ? 'por-entrar' : 'activo';
  return last.Salida && last.Salida >= hoy ? 'saliendo' : 'baja';
}
// Para Prospectos.gs → staffEsBaja_ (se llama en cada entrada con PIN, por eso va en caché).
// Devuelve true/false, o null si la persona no está en Equipo (entonces se usa STAFF_BAJAS).
function equipoEsBaja_(name) {
  try {
    var m = eqEstados_(), s = m[String(name || '').trim().toLowerCase()];
    if (!s) return null;
    return s === 'baja';
  } catch (e) { return null; }
}
function eqEstados_() {
  var c = CacheService.getScriptCache(), raw = c.get('eq_estados_v1');
  if (raw) return JSON.parse(raw);
  var m = {}, ss = eqSS_(), shP = ss.getSheetByName(EQ_SHEET), shE = ss.getSheetByName(EQ_PER_SHEET);
  if (shP && shE) {
    var tp = eqT_('p'), tpe = eqT_('pe'), hoy = eqToday_();
    tp.rows.forEach(function (r) {
      if (r.Usuario) m[String(r.Usuario).trim().toLowerCase()] = eqEstado_(eqPeriodsOf_(tpe, r.ID), hoy);
    });
  }
  c.put('eq_estados_v1', JSON.stringify(m), 600);
  return m;
}
function eqCacheClear_() { try { CacheService.getScriptCache().removeAll(['eq_estados_v1', 'eq_team_v1']); } catch (e) {} }

// Nombres para la pantalla de entrada del Hub (asesoras activas con PIN). Sin PIN, sin datos personales.
function eqTeamPublic_() {
  try {
    var c = CacheService.getScriptCache(), raw = c.get('eq_team_v1');
    if (raw) return JSON.parse(raw);
    var ss = eqSS_();
    if (!ss.getSheetByName(EQ_SHEET)) return { ok: true, activos: [], bajas: [], listo: false };
    var tp = eqT_('p'), tpe = eqT_('pe'), hoy = eqToday_(), cfg = eqCfg_(), act = [], bajas = [];
    tp.rows.forEach(function (r) {
      if (!r.Usuario) return;
      var est = eqEstado_(eqPeriodsOf_(tpe, r.ID), hoy);
      if (est === 'baja') bajas.push(r.Usuario);
      else if (est !== 'pendiente' && (r.Rol || 'rep') === 'rep' && cfg.usuarios[r.Usuario] && cfg.usuarios[r.Usuario].pin) act.push(r.Usuario);
    });
    var out = { ok: true, activos: act, bajas: bajas, listo: true };
    c.put('eq_team_v1', JSON.stringify(out), 300);
    return out;
  } catch (e) { return { ok: true, activos: [], bajas: [], listo: false }; }
}

// ─── PIN (vive en PROSPECTOS_CONFIG, el mismo que usan Prospectos, Mis líneas, Mi pago…) ───
function eqCfg_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PROSPECTOS_CONFIG');
  var c = raw ? JSON.parse(raw) : {};
  if (!c.usuarios) c.usuarios = {};
  return c;
}
function eqCfgSave_(cfg) { PropertiesService.getScriptProperties().setProperty('PROSPECTOS_CONFIG', JSON.stringify(cfg)); }
function eqCfgSync_(per, pin) {
  if (!per.Usuario) return;
  var cfg = eqCfg_(), u = cfg.usuarios[per.Usuario];
  if (!u && !pin) return;   // sin PIN todavía: no se crea la entrada
  if (pin !== undefined && pin !== null && pin !== '') {
    pin = String(pin);
    if (!/^\d{6}$/.test(pin) || pin === '000000') throw new Error('El PIN tiene 6 dígitos (no 000000).');
    if (/^(\d)\1{5}$/.test(pin) || pin === '123456' || pin === '654321') throw new Error('Ese PIN es muy fácil de adivinar. Usa otro.');
    Object.keys(cfg.usuarios).forEach(function (n) {
      if (n !== per.Usuario && String(cfg.usuarios[n].pin) === pin) throw new Error('Ese PIN ya lo usa otra persona. Usa otro.');
    });
  }
  if (!u) u = cfg.usuarios[per.Usuario] = { pin: '', manager: false, codigo: '', repIds: [] };
  if (pin) u.pin = String(pin);
  u.codigo = String(per.Codigo || '').toUpperCase();
  u.repIds = eqRepList_(per.RepIds);
  eqCfgSave_(cfg);
}

// ─── CARPETAS PRIVADAS EN DRIVE ────────────────────────────────────
function eqRoot_() {
  var P = PropertiesService.getScriptProperties(), id = P.getProperty('EQ_ROOT_ID'), f = null;
  if (id) { try { f = DriveApp.getFolderById(id); if (f.isTrashed()) f = null; } catch (e) { f = null; } }
  if (!f) {
    f = DriveApp.createFolder(EQ_ROOT_NAME);
    f.setDescription('Expedientes del equipo de MirComm (Hub → 👥 Equipo). Privado: no lo compartas.');
    P.setProperty('EQ_ROOT_ID', f.getId());
  }
  return f;
}
function eqSub_(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function eqI9_() { return eqSub_(eqRoot_(), EQ_I9_NAME); }
function eqFolderOk_(id) {
  if (!id) return null;
  try { var f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (e) { return null; }
}
function eqPersonFolder_(tp, per) {
  var f = eqFolderOk_(per.CarpetaId);
  if (f) return f;
  f = eqRoot_().createFolder((per.NombreCompleto || per.Usuario || 'Sin nombre') + ' · ' + per.ID);
  per.CarpetaId = f.getId(); eqWrite_(tp, per);
  return f;
}
function eqPeriodFolder_(tp, tpe, per, pe) {
  var f = eqFolderOk_(pe.CarpetaId);
  if (f) return f;
  f = eqPersonFolder_(tp, per).createFolder('Periodo ' + pe.Num + (pe.Ingreso ? ' · desde ' + pe.Ingreso : ''));
  pe.CarpetaId = f.getId(); eqWrite_(tpe, pe);
  return f;
}
function eqFolderUrl_(id) { return id ? 'https://drive.google.com/drive/folders/' + id : ''; }

// ─── LLENAR LA HOJA LA PRIMERA VEZ ─────────────────────────────────
function eqSeed_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('EQ_SEEDED')) return;
  var tp = eqT_('p'), tpe = eqT_('pe');
  if (tp.rows.length) { P.setProperty('EQ_SEEDED', eqNow_()); return; }
  var cfg = eqCfg_(), now = eqNow_(), seen = {};
  var bajas = (typeof STAFF_BAJAS === 'object' && STAFF_BAJAS) ? STAFF_BAJAS : {};
  var list = EQ_SEED.slice();
  Object.keys(cfg.usuarios).forEach(function (n) {
    if (cfg.usuarios[n].manager) return;
    var ya = list.some(function (s) { return s.usuario === n; });
    if (!ya) list.push({ usuario: n, nombre: n, genero: 'f', rol: 'rep', periodos: [
      bajas[n] ? { puesto: 'Sales Representative', ingreso: '', salida: bajas[n], estado: 'Cerrado', notas: 'Falta la fecha de ingreso.' }
               : { puesto: 'Sales Representative', ingreso: '', salida: '', estado: 'Abierto', notas: 'Falta la fecha de ingreso.' }] });
  });
  list.forEach(function (s) {
    if (seen[s.usuario]) return; seen[s.usuario] = 1;
    var u = cfg.usuarios[s.usuario] || {};
    var per = { ID: eqNextId_(tp.rows, 'EQ-', 3), Usuario: s.usuario, NombreCompleto: s.nombre, Genero: s.genero || 'f', Rol: s.rol || 'rep',
      Codigo: u.codigo || '', RepIds: (u.repIds || []).join(', '), Connecteam: '', Recontratar: '', Creado: now, Actualizado: now };
    eqWrite_(tp, per);
    s.periodos.forEach(function (x, i) {
      var pe = { ID: eqNextId_(tpe.rows, 'EP-', 4), PersonaID: per.ID, Num: String(i + 1), Estado: x.estado, Puesto: x.puesto,
        Ingreso: x.ingreso || '', Salida: x.salida || '', Entrada: '{}',
        Accesos: JSON.stringify(x.estado === 'Abierto' && u.pin ? { pin: { ok: true, f: '' } } : {}),
        Constancia: x.constancia ? JSON.stringify(x.constancia) : '', Notas: x.notas || '', Creado: now, Actualizado: now };
      eqWrite_(tpe, pe);
    });
  });
  P.setProperty('EQ_SEEDED', now);
}

// ─── LISTA ─────────────────────────────────────────────────────────
function eqList_() {
  eqSeed_();
  var tp = eqT_('p'), tpe = eqT_('pe'), td = eqT_('d'), cfg = eqCfg_(), hoy = eqToday_();
  var personas = tp.rows.map(function (r) {
    var pers = eqPeriodsOf_(tpe, r.ID), est = eqEstado_(pers, hoy), u = r.Usuario ? cfg.usuarios[r.Usuario] : null;
    return {
      id: r.ID, usuario: r.Usuario, nombre: r.NombreCompleto || r.Usuario, genero: r.Genero || 'f', rol: r.Rol || 'rep',
      telefono: r.Telefono, correoPersonal: r.CorreoPersonal, correoEmpresa: r.CorreoEmpresa, direccion: r.Direccion,
      emergencia: r.Emergencia, codigo: r.Codigo, repIds: eqRepList_(r.RepIds), connecteam: r.Connecteam,
      recontratar: r.Recontratar, recontratarNota: r.RecontratarNota, notas: r.Notas, carpeta: eqFolderUrl_(r.CarpetaId),
      estado: est, pinSet: !!(u && u.pin), pinActivo: !!(u && u.pin) && est !== 'baja', creado: r.Creado, actualizado: r.Actualizado
    };
  });
  return { ok: true, hoy: hoy, personas: personas, periodos: tpe.rows.map(eqPerOut_), docs: td.rows.map(eqDocOut_) };
}
function eqPerOut_(r) {
  var c = eqJ_(r.Constancia), en = eqJ_(r.Entrada), link = en._link || null;
  delete en._link;
  return {
    id: r.ID, personaId: r.PersonaID, num: +r.Num || 1, estado: r.Estado || 'Abierto', puesto: r.Puesto, ingreso: r.Ingreso,
    salida: r.Salida, pago: r.Pago, tipoSalida: r.TipoSalida, motivo: r.Motivo, entrada: en, accesos: eqJ_(r.Accesos),
    link: link ? { vence: link.vence, creado: link.creado, hecho: link.hecho || '' } : null,
    constancia: { tiene: !!r.Constancia, firmaE: !!c.sigEFile, firmaM: !!c.sigMFile, acc: c.acc || {}, prop: c.prop || {}, tipo: c.tipo || '' },
    carpeta: eqFolderUrl_(r.CarpetaId), notas: r.Notas
  };
}
function eqDocOut_(r) {
  return { id: r.ID, personaId: r.PersonaID, periodoId: r.PeriodoID, tipo: r.Tipo, nombre: r.Nombre, url: r.Url,
    vence: r.Vence, fuente: r.Fuente, subido: r.Subido, por: r.Por, nota: r.Nota };
}

// ─── GUARDAR DATOS DE LA FICHA ─────────────────────────────────────
var EQ_FIELDS = { nombre: 'NombreCompleto', genero: 'Genero', rol: 'Rol', telefono: 'Telefono', correoPersonal: 'CorreoPersonal',
  correoEmpresa: 'CorreoEmpresa', direccion: 'Direccion', emergencia: 'Emergencia', codigo: 'Codigo', repIds: 'RepIds',
  connecteam: 'Connecteam', recontratar: 'Recontratar', recontratarNota: 'RecontratarNota', notas: 'Notas' };
function eqApplyFields_(per, f) {
  Object.keys(EQ_FIELDS).forEach(function (k) {
    if (f[k] === undefined) return;
    var v = f[k];
    if (k === 'telefono') v = eqPhone_(v);
    else if (k === 'repIds') v = eqRepList_(v).join(', ');
    else if (k === 'codigo') v = eqStr_(v, 12).toUpperCase();
    else if (k === 'genero') v = v === 'm' ? 'm' : 'f';
    else if (k === 'rol') v = ['rep', 'admin', 'otro'].indexOf(v) >= 0 ? v : 'rep';
    else if (k === 'recontratar') v = EQ_RECONTRATAR.indexOf(v) >= 0 ? v : '';
    else v = eqNoSsn_(eqStr_(v, k === 'notas' || k === 'recontratarNota' ? 2000 : 300));
    per[EQ_FIELDS[k]] = v;
  });
}
function eqCheckUsuario_(tp, usuario, selfId) {
  usuario = eqStr_(usuario, 30);
  if (!usuario) return '';
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ .'-]{1,29}$/.test(usuario)) throw new Error('El nombre corto para el Hub solo lleva letras (ej.: Lizbeth).');
  tp.rows.forEach(function (r) {
    if (r.ID !== selfId && r.Usuario && r.Usuario.toLowerCase() === usuario.toLowerCase())
      throw new Error('Ya hay alguien en Equipo con el nombre corto "' + usuario + '". Usa otro (ej.: con la inicial del apellido).');
  });
  return usuario;
}
function eqSave_(d) {
  var tp = eqT_('p'), per = eqById_(tp, d.id);
  if (!per) throw new Error('No encontré esa ficha.');
  var f = d.fields || {};
  if (f.usuario !== undefined && f.usuario !== per.Usuario) {
    var cfg = eqCfg_();
    if (per.Usuario && cfg.usuarios[per.Usuario]) throw new Error('El nombre corto ya tiene PIN y su historial depende de él; no se puede cambiar.');
    per.Usuario = eqCheckUsuario_(tp, f.usuario, per.ID);
  }
  eqApplyFields_(per, f);
  per.Actualizado = eqNow_();
  eqWrite_(tp, per);
  eqCfgSync_(per);
  return { ok: true };
}

// ─── ALTA y REINGRESO ──────────────────────────────────────────────
// d = { personaId? (reingreso), fields:{usuario,nombre,…}, periodo:{puesto, ingreso, pago}, pin?, forzar? }
function eqAlta_(d) {
  var tp = eqT_('p'), tpe = eqT_('pe'), now = eqNow_(), per, nuevo = false, warn = [];
  var f = d.fields || {}, pr = d.periodo || {};
  if (!eqYmd_(pr.ingreso)) throw new Error('Pon la fecha de ingreso.');
  if (d.personaId) {
    per = eqById_(tp, d.personaId);
    if (!per) throw new Error('No encontré esa ficha.');
    var pers = eqPeriodsOf_(tpe, per.ID), last = pers[pers.length - 1];
    if (last && last.Estado !== 'Cerrado') throw new Error('Esta persona ya tiene un periodo abierto. Para un reingreso primero se da de baja el anterior.');
    if (last && last.Salida && pr.ingreso <= last.Salida) throw new Error('La fecha de reingreso tiene que ser después de su última salida (' + last.Salida + ').');
    if (per.Recontratar === 'No' && !d.forzar) throw new Error('En su baja quedó marcada como NO elegible para recontratar.');
  } else {
    if (!eqStr_(f.nombre)) throw new Error('Pon el nombre completo.');
    var dup = tp.rows.filter(function (r) { return eqNorm_(r.NombreCompleto) === eqNorm_(f.nombre); })[0];
    if (dup && !d.forzar) throw new Error('Ya existe una ficha de ' + dup.NombreCompleto + '. Ábrela y usa ↩ Reingreso.');
    per = { ID: eqNextId_(tp.rows, 'EQ-', 3), Creado: now };
    per.Usuario = eqCheckUsuario_(tp, f.usuario, per.ID);
    if ((f.rol || 'rep') === 'rep' && !per.Usuario) throw new Error('Pon el nombre corto con el que va a entrar al Hub.');
    nuevo = true;
  }
  if (!nuevo && f.usuario !== undefined && !per.Usuario) per.Usuario = eqCheckUsuario_(tp, f.usuario, per.ID);
  eqApplyFields_(per, f);
  if (nuevo && !per.Rol) per.Rol = 'rep';
  per.Recontratar = per.Recontratar || ''; per.Actualizado = now;
  // PIN primero: si no es válido, no se guarda nada
  if (d.pin) eqCfgSync_(per, d.pin);
  eqWrite_(tp, per);
  if (!d.pin) eqCfgSync_(per);
  var num = eqPeriodsOf_(tpe, per.ID).length + 1;
  var pe = { ID: eqNextId_(tpe.rows, 'EP-', 4), PersonaID: per.ID, Num: String(num), Estado: 'Abierto',
    Puesto: eqStr_(pr.puesto, 80) || 'Sales Representative', Ingreso: pr.ingreso, Salida: '', Pago: eqStr_(pr.pago, 120),
    Entrada: '{}', Accesos: '{}', Constancia: '', Notas: num > 1 ? 'Reingreso.' : '', Creado: now, Actualizado: now };
  var cfg = eqCfg_();
  if (per.Usuario && cfg.usuarios[per.Usuario] && cfg.usuarios[per.Usuario].pin) pe.Accesos = JSON.stringify({ pin: { ok: true, f: eqToday_() } });
  if (per.RepIds) { var a = eqJ_(pe.Accesos); a.repId = { ok: true, f: eqToday_() }; pe.Accesos = JSON.stringify(a); }
  if (per.CorreoEmpresa) { var a2 = eqJ_(pe.Accesos); a2.correo = { ok: true, f: eqToday_() }; pe.Accesos = JSON.stringify(a2); }
  eqWrite_(tpe, pe);
  try { eqPeriodFolder_(tp, tpe, per, pe); } catch (e) { warn.push('No se pudo crear la carpeta en Drive (' + e.message + '). Corre instalarEquipo una vez para dar el permiso.'); }
  var link = eqLinkMake_(tpe, pe);
  return { ok: true, personaId: per.ID, periodoId: pe.ID, link: link, warn: warn };
}

// ─── BAJA ──────────────────────────────────────────────────────────
// d = { personaId, salida, tipo, motivo, recontratar, recontratarNota }
function eqBaja_(d) {
  var tp = eqT_('p'), tpe = eqT_('pe'), per = eqById_(tp, d.personaId), now = eqNow_();
  if (!per) throw new Error('No encontré esa ficha.');
  var pers = eqPeriodsOf_(tpe, per.ID), pe = pers[pers.length - 1];
  if (!pe || pe.Estado === 'Cerrado') throw new Error('No tiene un periodo abierto.');
  if (!eqYmd_(d.salida)) throw new Error('Pon la fecha de salida (último día).');
  if (pe.Ingreso && d.salida < pe.Ingreso) throw new Error('La salida no puede ser antes del ingreso (' + pe.Ingreso + ').');
  pe.Estado = 'Cerrado'; pe.Salida = d.salida; pe.TipoSalida = eqStr_(d.tipo, 30); pe.Motivo = eqNoSsn_(eqStr_(d.motivo, 2000));
  // La constancia arranca con lo que ya se sabe
  var c = eqJ_(pe.Constancia);
  var pre = { nombre: per.NombreCompleto, genero: per.Genero || 'f', puesto: pe.Puesto, ingreso: pe.Ingreso, salida: pe.Salida,
    tipo: pe.TipoSalida, motivo: pe.Motivo, repId: eqRepList_(per.RepIds)[0] || '' };
  if (!c.sigEFile && !c.sigMFile) Object.keys(pre).forEach(function (k) { if (pre[k]) c[k] = pre[k]; });
  pe.Constancia = JSON.stringify(c);
  pe.Actualizado = now; eqWrite_(tpe, pe);
  if (d.recontratar !== undefined) per.Recontratar = EQ_RECONTRATAR.indexOf(d.recontratar) >= 0 ? d.recontratar : '';
  if (d.recontratarNota !== undefined) per.RecontratarNota = eqStr_(d.recontratarNota, 2000);
  per.Actualizado = now; eqWrite_(tp, per);
  return { ok: true, periodoId: pe.ID, pinHasta: d.salida };
}

// ─── PERIODO (fechas, checklist de entrada, accesos) ───────────────
// d = { periodoId, fields:{puesto,ingreso,salida,pago,tipoSalida,motivo,notas}, entrada:{k:{st,f,n}|null}, accesos:{k:{ok,f,n}|null}, reabrir? }
function eqPeriodo_(d) {
  var tpe = eqT_('pe'), pe = eqById_(tpe, d.periodoId);
  if (!pe) throw new Error('No encontré ese periodo.');
  var f = d.fields || {};
  ['puesto', 'pago', 'tipoSalida', 'motivo', 'notas'].forEach(function (k) {
    if (f[k] !== undefined) pe[k.charAt(0).toUpperCase() + k.slice(1)] = eqNoSsn_(eqStr_(f[k], k === 'motivo' || k === 'notas' ? 2000 : 120));
  });
  ['ingreso', 'salida'].forEach(function (k) {
    if (f[k] === undefined) return;
    var v = String(f[k] || '');
    if (v && !eqYmd_(v)) throw new Error('Fecha no válida.');
    if (k === 'salida' && pe.Estado !== 'Cerrado' && v) throw new Error('Para poner la salida usa 🚪 Dar de baja.');
    pe[k === 'ingreso' ? 'Ingreso' : 'Salida'] = v;
  });
  if (pe.Ingreso && pe.Salida && pe.Salida < pe.Ingreso) throw new Error('La salida no puede ser antes del ingreso.');
  if (d.reabrir) {
    var pers = eqPeriodsOf_(tpe, pe.PersonaID);
    if (pers[pers.length - 1].ID !== pe.ID) throw new Error('Solo se puede reabrir el último periodo.');
    pe.Estado = 'Abierto'; pe.Salida = ''; pe.TipoSalida = ''; pe.Motivo = '';
  }
  ['entrada', 'accesos'].forEach(function (grp) {
    if (!d[grp]) return;
    var col = grp === 'entrada' ? 'Entrada' : 'Accesos', cur = eqJ_(pe[col]);
    Object.keys(d[grp]).forEach(function (k) {
      if (k.charAt(0) === '_') return;
      var v = d[grp][k];
      if (v === null) { delete cur[k]; return; }
      var o = cur[k] || {};
      if (grp === 'entrada') { if (v.st !== undefined) o.st = ['', 'rec', 'ok', 'na'].indexOf(v.st) >= 0 ? v.st : ''; }
      else if (v.ok !== undefined) o.ok = !!v.ok;
      if (v.f !== undefined) o.f = eqYmd_(v.f);
      if (v.n !== undefined) o.n = eqNoSsn_(eqStr_(v.n, 300));
      o.por = eqWho_();
      cur[k] = o;
    });
    pe[col] = JSON.stringify(cur);
  });
  pe.Actualizado = eqNow_(); eqWrite_(tpe, pe);
  return { ok: true, periodo: eqPerOut_(pe) };
}

// ─── PIN ───────────────────────────────────────────────────────────
function eqPin_(d) {
  var tp = eqT_('p'), per = eqById_(tp, d.personaId);
  if (!per) throw new Error('No encontré esa ficha.');
  if (!per.Usuario) {
    if (!d.usuario) throw new Error('Primero pon el nombre corto con el que va a entrar al Hub.');
    per.Usuario = eqCheckUsuario_(tp, d.usuario, per.ID); eqWrite_(tp, per);
  }
  eqCfgSync_(per, String(d.pin || ''));
  var tpe = eqT_('pe'), pers = eqPeriodsOf_(tpe, per.ID), pe = pers[pers.length - 1];
  if (pe && pe.Estado !== 'Cerrado') {
    var a = eqJ_(pe.Accesos); a.pin = { ok: true, f: eqToday_(), por: eqWho_() }; pe.Accesos = JSON.stringify(a); eqWrite_(tpe, pe);
  }
  return { ok: true };
}

// ─── DOCUMENTOS (Drive privado) ────────────────────────────────────
// d = { personaId, periodoId, tipo, nombre, mime, b64, vence, nota }
function eqDocUp_(d) {
  var tp = eqT_('p'), tpe = eqT_('pe'), td = eqT_('d');
  var r = eqDocSave_(tp, tpe, td, d, 'Hub', eqWho_());
  return { ok: true, doc: eqDocOut_(r) };
}
function eqDocSave_(tp, tpe, td, d, fuente, por) {
  var per = eqById_(tp, d.personaId);
  if (!per) throw new Error('No encontré esa ficha.');
  var pe = d.periodoId ? eqById_(tpe, d.periodoId) : null;
  if (d.periodoId && (!pe || pe.PersonaID !== per.ID)) throw new Error('Ese periodo no es de esta persona.');
  var tipo = EQ_TIPOS[d.tipo] ? d.tipo : 'otro';
  var b64 = String(d.b64 || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw new Error('Falta el archivo.');
  if (b64.length > EQ_MAX_B64) throw new Error('El archivo pesa demasiado (máx. ~10 MB). Toma la foto otra vez o guarda el PDF más ligero.');
  var mime = eqStr_(d.mime, 80) || 'application/octet-stream';
  var ext = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : /jpe?g/.test(mime) ? '.jpg' : '';
  var orig = eqStr_(d.nombre, 120).replace(/[\\\/:*?"<>|]+/g, ' ');
  if (!ext) { var m = orig.match(/\.[A-Za-z0-9]{2,5}$/); ext = m ? m[0] : ''; }
  var hoy = eqToday_();
  var fname = EQ_TIPOS[tipo] + ' · ' + (per.NombreCompleto || per.Usuario) + (pe ? ' · periodo ' + pe.Num : '') + ' · ' + hoy + ext;
  var folder = tipo === 'i9' ? eqI9_() : pe ? eqPeriodFolder_(tp, tpe, per, pe) : eqPersonFolder_(tp, per);
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime, fname));
  file.setDescription('Hub → 👥 Equipo · ' + per.ID + (pe ? ' · ' + pe.ID : '') + ' · ' + (orig || ''));
  var row = { ID: eqNextId_(td.rows, 'ED-', 5), PersonaID: per.ID, PeriodoID: pe ? pe.ID : '', Tipo: tipo,
    Nombre: orig || fname, ArchivoID: file.getId(), Url: file.getUrl(), Vence: eqYmd_(d.vence), Fuente: fuente,
    Subido: eqNow_(), Por: por, Nota: eqNoSsn_(eqStr_(d.nota, 300)) };
  eqWrite_(td, row);
  // Marca el renglón del checklist de entrada
  if (pe && EQ_CHECK_KEYS.indexOf(tipo) >= 0) {
    var en = eqJ_(pe.Entrada), cur = en[tipo] || {};
    if (fuente === 'Hub') en[tipo] = { st: 'ok', f: hoy, por: por, n: cur.n || '' };
    else if (cur.st !== 'ok') en[tipo] = { st: 'rec', f: hoy, por: fuente, n: cur.n || '' };
    pe.Entrada = JSON.stringify(en); pe.Actualizado = eqNow_(); eqWrite_(tpe, pe);
  }
  return row;
}
function eqDocEdit_(d) {
  var td = eqT_('d'), r = eqById_(td, d.id);
  if (!r) throw new Error('No encontré ese documento.');
  if (d.vence !== undefined) r.Vence = eqYmd_(d.vence);
  if (d.nota !== undefined) r.Nota = eqNoSsn_(eqStr_(d.nota, 300));
  eqWrite_(td, r);
  return { ok: true, doc: eqDocOut_(r) };
}
function eqDocDel_(d) {
  var td = eqT_('d'), r = eqById_(td, d.id);
  if (!r) throw new Error('No encontré ese documento.');
  try { DriveApp.getFileById(r.ArchivoID).setTrashed(true); } catch (e) {}   // va a la papelera de Drive (30 días)
  eqDelRow_(td, r);
  return { ok: true };
}

// ─── CONSTANCIA DE SALIDA (en la ficha) ────────────────────────────
function eqConstGet_(d) {
  var tpe = eqT_('pe'), pe = eqById_(tpe, d.periodoId);
  if (!pe) throw new Error('No encontré ese periodo.');
  var c = eqJ_(pe.Constancia), out = {};
  Object.keys(c).forEach(function (k) { if (k !== 'sigEFile' && k !== 'sigMFile') out[k] = c[k]; });
  return { ok: true, data: pe.Constancia ? out : null, sigE: eqSigRead_(c.sigEFile), sigM: eqSigRead_(c.sigMFile) };
}
function eqSigRead_(id) {
  if (!id) return '';
  try { return 'data:image/png;base64,' + Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); } catch (e) { return ''; }
}
// d = { periodoId, data:{…sin firmas}, sigE?: dataURL|'' , sigM?: dataURL|'', unlock? }
function eqConstSave_(d) {
  var tp = eqT_('p'), tpe = eqT_('pe'), pe = eqById_(tpe, d.periodoId);
  if (!pe) throw new Error('No encontré ese periodo.');
  var c = eqJ_(pe.Constancia), firmado = !!(c.sigEFile || c.sigMFile), inc = d.data || {};
  // Con firmas, el contenido no cambia (salvo que se desbloquee, lo que borra las firmas)
  if (!firmado || d.unlock) {
    Object.keys(inc).forEach(function (k) {
      if (k === 'sigE' || k === 'sigM' || k === 'sigEFile' || k === 'sigMFile') return;
      c[k] = typeof inc[k] === 'string' ? eqNoSsn_(inc[k]).slice(0, 4000) : inc[k];
    });
  }
  var per = eqById_(tp, pe.PersonaID);
  ['E', 'M'].forEach(function (w) {
    var v = d['sig' + w];
    if (d.unlock && v === undefined) v = '';
    if (v === undefined) return;
    if (c['sig' + w + 'File']) { try { DriveApp.getFileById(c['sig' + w + 'File']).setTrashed(true); } catch (e) {} delete c['sig' + w + 'File']; }
    if (v && /^data:image\/png;base64,/.test(v)) {
      var folder = eqPeriodFolder_(tp, tpe, per, pe);
      var f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(v.split(',')[1]), 'image/png',
        'Firma ' + (w === 'E' ? 'de ' + (per.NombreCompleto || per.Usuario) : 'MirComm') + ' · constancia de salida.png'));
      c['sig' + w + 'File'] = f.getId();
      c['sig' + w + 'At'] = eqStr_(inc['sig' + w + 'At'], 40) || new Date().toISOString();
    } else c['sig' + w + 'At'] = '';
  });
  pe.Constancia = JSON.stringify(c); pe.Actualizado = eqNow_(); eqWrite_(tpe, pe);
  return { ok: true, firmaE: !!c.sigEFile, firmaM: !!c.sigMFile };
}

// ─── LINK DE ALTA (la persona llena desde su teléfono) ─────────────
function eqLinkKey_() {
  var P = PropertiesService.getScriptProperties(), k = P.getProperty('EQ_LINK_KEY');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); P.setProperty('EQ_LINK_KEY', k); }
  return k;
}
function eqSign_(s) {
  var b = Utilities.computeHmacSha256Signature(s, eqLinkKey_()), h = '';
  for (var i = 0; i < b.length && h.length < 24; i++) h += ('0' + (b[i] & 255).toString(16)).slice(-2);
  return h;
}
function eqLinkMake_(tpe, pe) {
  var nonce = Utilities.getUuid().replace(/-/g, '').slice(0, 6);
  var vence = eqAddDays_(eqToday_(), EQ_LINK_DIAS), s = 'eqa.' + pe.ID + '.' + vence + '.' + nonce, t = s + '.' + eqSign_(s);
  var en = eqJ_(pe.Entrada);
  en._link = { t: t, vence: vence, creado: eqNow_(), hecho: '' };   // un link nuevo deja sin efecto el anterior
  pe.Entrada = JSON.stringify(en); eqWrite_(tpe, pe);
  return { t: t, vence: vence };
}
function eqLink_(d) {
  var tpe = eqT_('pe'), pe = eqById_(tpe, d.periodoId);
  if (!pe) throw new Error('No encontré ese periodo.');
  if (pe.Estado === 'Cerrado') throw new Error('Ese periodo ya está cerrado.');
  return { ok: true, link: eqLinkMake_(tpe, pe) };
}
// → { pe, per, tpe, tp } o { error }
function eqTokenRead_(t) {
  var m = String(t || '').match(/^eqa\.(EP-\d+)\.(\d{4}-\d{2}-\d{2})\.([0-9a-f]{6})\.([0-9a-f]{24})$/);
  if (!m || eqSign_('eqa.' + m[1] + '.' + m[2] + '.' + m[3]) !== m[4]) return { error: 'Este link no es válido. Pídele a Joel uno nuevo.' };
  if (eqToday_() > m[2]) return { error: 'Este link ya venció. Pídele a Joel uno nuevo.' };
  var tpe = eqT_('pe'), pe = eqById_(tpe, m[1]);
  if (!pe || pe.Estado === 'Cerrado') return { error: 'Este link ya no está activo.' };
  var en = eqJ_(pe.Entrada);
  if (!en._link || en._link.t !== String(t)) return { error: 'Este link ya se reemplazó por uno nuevo. Usa el último que te mandaron.' };
  var tp = eqT_('p'), per = eqById_(tp, pe.PersonaID);
  if (!per) return { error: 'Este link ya no está activo.' };
  return { pe: pe, per: per, tpe: tpe, tp: tp, en: en };
}

// ─── TEXTOS DEL ALTA ───────────────────────────────────────────────
function eqTextos_() {
  var raw = PropertiesService.getScriptProperties().getProperty('EQ_TEXTOS'), t = {}, o = raw ? eqJ_(raw) : {};
  Object.keys(EQ_TEXTOS_DEF).forEach(function (k) { t[k] = o[k] || EQ_TEXTOS_DEF[k]; });
  return t;
}
function eqTextosSave_(d) {
  var t = {};
  Object.keys(EQ_TEXTOS_DEF).forEach(function (k) {
    var v = eqStr_(d[k], 8000);
    if (v && v !== EQ_TEXTOS_DEF[k]) t[k] = v;
  });
  PropertiesService.getScriptProperties().setProperty('EQ_TEXTOS', JSON.stringify(t));
  return { ok: true, textos: eqTextos_() };
}

// ─── PÁGINA DEL LINK DE ALTA ───────────────────────────────────────
function eqFormPage_(p) {
  var r;
  try { r = eqTokenRead_(p.t); } catch (e) { r = { error: 'No se pudo abrir: ' + e.message }; }
  var css = 'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#F2F4F8;color:#111827;font-size:16px}' +
    '.w{max-width:560px;margin:0 auto;padding:16px 14px 60px}.hd{text-align:center;margin:10px 0 18px}.lg{font-weight:800;font-size:26px;color:#1A6EFF}' +
    '.c{background:#fff;border:1px solid #E1E5EE;border-radius:14px;padding:16px;margin:0 0 14px}h2{font-size:17px;margin:0 0 4px}.en{color:#6B7280;font-size:13px;font-weight:400}' +
    'label{display:block;font-size:13px;font-weight:700;margin:12px 0 4px;color:#374151}input[type=text],input[type=tel],input[type=email],input[type=date]{width:100%;box-sizing:border-box;padding:12px;border:1px solid #CBD2DE;border-radius:10px;font-size:16px;background:#fff}' +
    '.note{font-size:13px;color:#92400E;background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:10px;margin:8px 0}' +
    '.doc{border:1px dashed #CBD2DE;border-radius:12px;padding:12px;margin:10px 0}.doc b{display:block}.doc small{color:#6B7280}.ok{color:#047857;font-weight:700}' +
    '.txt{white-space:pre-wrap;font-size:14px;line-height:1.45;max-height:260px;overflow:auto;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px}' +
    'details{margin-top:8px;font-size:14px}.ck{display:flex;gap:10px;align-items:flex-start;font-size:15px;margin:12px 0;font-weight:400}.ck input{width:22px;height:22px;margin-top:1px}' +
    'canvas{width:100%;height:190px;border:1px solid #CBD2DE;border-radius:10px;background:#fff;touch-action:none}' +
    '.btn{display:block;width:100%;padding:16px;border:0;border-radius:999px;background:#1A6EFF;color:#fff;font-size:17px;font-weight:700;margin-top:10px}' +
    '.btn2{background:none;border:0;color:#1A6EFF;font-size:14px;padding:6px 0}.err{color:#B91C1C;font-size:14px;margin-top:10px}';
  var head = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div class="w"><div class="hd"><div class="lg">MirComm</div>';
  if (r.error) {
    return HtmlService.createHtmlOutput(head + '<div class="c" style="text-align:center">' + eqEsc_(r.error) + '</div></div></body></html>')
      .setTitle('MirComm · Papeles de entrada').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  var per = r.per, en = r.en, tx = eqTextos_();
  var D = {
    t: String(p.t), nombre: per.NombreCompleto || '', corto: (per.NombreCompleto || per.Usuario || '').split(' ')[0],
    telefono: per.Telefono || '', correo: per.CorreoPersonal || '', direccion: per.Direccion || '', emergencia: per.Emergencia || '',
    rec: {}, tx: tx
  };
  EQ_CHECK_KEYS.forEach(function (k) { if (en[k] && (en[k].st === 'ok' || en[k].st === 'rec')) D.rec[k] = 1; });
  var js = [
    'var D=' + JSON.stringify(D).replace(/</g, '\\u003c') + ';',
    'var DOCS=[["id","Identificación (foto del frente)","Photo ID (front)",1],["w4","W-4","W-4 form",0],["i9","Formulario I-9 · sección 1","Form I-9 · section 1",0],',
    '["deposito","Depósito directo (forma o cheque anulado)","Direct deposit (form or voided check)",0],["oferta","Carta de oferta firmada","Signed offer letter",0]];',
    'var files={},pad=null,ink=0;',
    'function $(i){return document.getElementById(i)}',
    'function esc(s){return String(s||"").replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}',
    'function init(){',
    ' $("hola").textContent="Hola "+D.corto;',
    ' ["nombre","telefono","correo","direccion"].forEach(function(k){$(k).value=D[k]||""});',
    ' var em=(D.emergencia||"").split(" · ");$("emN").value=em[0]||"";$("emT").value=em[1]||"";$("emR").value=em[2]||"";',
    ' var h="";DOCS.forEach(function(d){h+="<div class=doc><b>"+d[1]+" <span class=en>· "+d[2]+"</span></b>"+(D.rec[d[0]]?"<div class=ok>✓ Ya lo recibimos · Received</div><small>Si quieres mandarlo otra vez, escógelo abajo.</small>":"")+',
    '  "<input type=file accept=\\"image/*,application/pdf\\" onchange=\\"pick(\'"+d[0]+"\',this)\\"><div id=\\"st_"+d[0]+"\\"><small></small></div>"+(d[3]?"<label>Fecha en que vence · Expiration date</label><input type=date id=\\"vence_"+d[0]+"\\">":"")+"</div>"});',
    ' $("docs").innerHTML=h;',
    ' $("tR").textContent=D.tx.reglasEs;$("tRe").textContent=D.tx.reglasEn;$("tC").textContent=D.tx.confEs;$("tCe").textContent=D.tx.confEn;',
    ' sig();',
    '}',
    'function pick(k,inp){var f=inp.files&&inp.files[0];if(!f){delete files[k];return}',
    ' var st=$("st_"+k);st.innerHTML="<small>Preparando…</small>";',
    ' var done=function(b64,mime){files[k]={b64:b64,mime:mime,nombre:f.name};st.innerHTML="<small class=ok>✓ "+esc(f.name)+"</small>"};',
    ' var rd=new FileReader();rd.onload=function(){var url=rd.result;',
    '  if(/^image\\//.test(f.type)){var im=new Image();im.onload=function(){var mx=1800,s=Math.min(1,mx/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);',
    '   var x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);done(c.toDataURL("image/jpeg",0.85),"image/jpeg")};',
    '   im.onerror=function(){done(url,f.type)};im.src=url}',
    '  else done(url,f.type||"application/pdf")};',
    ' rd.readAsDataURL(f)}',
    'function sig(){var cv=$("cv"),r=cv.getBoundingClientRect(),dp=window.devicePixelRatio||1;cv.width=r.width*dp;cv.height=r.height*dp;var x=cv.getContext("2d");x.scale(dp,dp);x.lineWidth=2.4;x.lineCap="round";x.lineJoin="round";x.strokeStyle="#0B1B3A";',
    ' var dn=false,l=null,ps=function(e){var b=cv.getBoundingClientRect();return{x:e.clientX-b.left,y:e.clientY-b.top}};',
    ' cv.onpointerdown=function(e){e.preventDefault();cv.setPointerCapture(e.pointerId);dn=true;l=ps(e)};',
    ' cv.onpointermove=function(e){if(!dn)return;e.preventDefault();var p=ps(e);x.beginPath();x.moveTo(l.x,l.y);x.lineTo(p.x,p.y);x.stroke();ink+=Math.abs(p.x-l.x)+Math.abs(p.y-l.y);l=p};',
    ' cv.onpointerup=cv.onpointercancel=function(){dn=false};pad=cv}',
    'function clr(){var x=pad.getContext("2d");x.save();x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,pad.width,pad.height);x.restore();ink=0}',
    'function send(){var e=$("err");e.textContent="";',
    ' var data={nombre:$("nombre").value.trim(),telefono:$("telefono").value.trim(),correo:$("correo").value.trim(),direccion:$("direccion").value.trim(),',
    '  emergencia:[$("emN").value.trim(),$("emT").value.trim(),$("emR").value.trim()].join(" · ").replace(/( · )+$/,""),files:[],acepta:{reglas:$("aR").checked,conf:$("aC").checked},firma:""};',
    ' if(!data.nombre||!data.telefono){e.textContent="Falta tu nombre completo y tu teléfono.";return}',
    ' if(/\\b\\d{3}[- ]?\\d{2}[- ]?\\d{4}\\b/.test(JSON.stringify([data.nombre,data.direccion,data.emergencia,data.correo]))){e.textContent="No escribas tu número de Seguro Social en estos campos.";return}',
    ' Object.keys(files).forEach(function(k){var v=$("vence_"+k);data.files.push({tipo:k,b64:files[k].b64,mime:files[k].mime,nombre:files[k].nombre,vence:v?v.value:""})});',
    ' if((data.acepta.reglas||data.acepta.conf)&&ink<40){e.textContent="Firma en el cuadro para aceptar las reglas y la confidencialidad.";return}',
    ' if(!(data.acepta.reglas&&data.acepta.conf)&&!D.rec.reglas&&!window._sinAcepta){window._sinAcepta=1;e.textContent="No marcaste que aceptas las reglas y la confidencialidad. Si quieres mandarlo así, toca Enviar otra vez (Joel te lo va a pedir después).";return}',
    ' if(ink>=40&&(data.acepta.reglas||data.acepta.conf))data.firma=pad.toDataURL("image/png");',
    ' var b=$("go");b.disabled=true;b.textContent="Enviando… no cierres esta página";',
    ' google.script.run.withSuccessHandler(function(r){if(r&&r.ok){$("form").style.display="none";$("done").style.display="block"}else{b.disabled=false;b.textContent="Enviar";e.textContent="No se envió: "+(r&&r.error||"")}})',
    '  .withFailureHandler(function(x){b.disabled=false;b.textContent="Enviar";e.textContent="No se envió: "+x.message+" (si mandaste muchas fotos, intenta con menos a la vez)"}).eqFormSubmit(D.t,data)}',
    'window.onload=init;'
  ].join('\n');
  var body = '<div style="font-size:20px;font-weight:700" id="hola"></div><div class="en">Papeles de entrada · New hire paperwork</div></div>' +
    '<div id="form">' +
    '<div class="c"><h2>1. Tus datos <span class="en">· Your information</span></h2>' +
    '<div class="note">No escribas tu número de Seguro Social en ningún campo. · Do not type your Social Security number anywhere.</div>' +
    '<label>Nombre completo · Full name</label><input type="text" id="nombre" autocomplete="name">' +
    '<label>Teléfono · Phone</label><input type="tel" id="telefono" autocomplete="tel">' +
    '<label>Correo personal · Personal email</label><input type="email" id="correo" autocomplete="email">' +
    '<label>Dirección · Address</label><input type="text" id="direccion" autocomplete="street-address">' +
    '<label>Contacto de emergencia · Emergency contact</label><input type="text" id="emN" placeholder="Nombre · Name">' +
    '<input type="tel" id="emT" placeholder="Teléfono · Phone" style="margin-top:8px"><input type="text" id="emR" placeholder="Parentesco · Relationship" style="margin-top:8px"></div>' +
    '<div class="c"><h2>2. Documentos <span class="en">· Documents</span></h2><div class="en">Toma una foto clara o sube el PDF. Se guardan en una carpeta privada. · Take a clear photo or upload the PDF. They are stored in a private folder.</div><div id="docs"></div></div>' +
    '<div class="c"><h2>3. Reglas y confidencialidad <span class="en">· Rules and confidentiality</span></h2>' +
    '<div class="txt" id="tR"></div><details><summary>English</summary><div class="txt" id="tRe"></div></details>' +
    '<label class="ck"><input type="checkbox" id="aR"> Leí y acepto las reglas de la tienda. · I have read and accept the store rules.</label>' +
    '<div class="txt" id="tC"></div><details><summary>English</summary><div class="txt" id="tCe"></div></details>' +
    '<label class="ck"><input type="checkbox" id="aC"> Leí y acepto el acuerdo de confidencialidad. · I have read and accept the confidentiality agreement.</label>' +
    '<label>Tu firma · Your signature</label><canvas id="cv"></canvas><button class="btn2" type="button" onclick="clr()">Borrar firma · Clear</button></div>' +
    '<button class="btn" id="go" onclick="send()">Enviar · Submit</button><div class="err" id="err"></div></div>' +
    '<div id="done" class="c" style="display:none;text-align:center"><div style="font-size:40px">✅</div><div style="font-size:18px;font-weight:700;margin:6px 0">¡Listo, gracias!</div>' +
    '<div class="en">Ya le llegó a Joel. Si falta algo, él te avisa. · Joel has it now. If anything is missing, he will let you know.</div></div>';
  return HtmlService.createHtmlOutput(head + body + '</div><script>' + js + '</script></body></html>')
    .setTitle('MirComm · Papeles de entrada').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// La llama la página del link de alta (google.script.run). Guarda datos, fotos y la firma de reglas/confidencialidad.
function eqFormSubmit(t, data) {
  try {
    return eqLock_(function () {
      var r = eqTokenRead_(t);
      if (r.error) return { ok: false, error: r.error };
      data = data || {};
      var per = r.per, pe = r.pe, tp = r.tp, tpe = r.tpe, td = eqT_('d'), now = eqNow_(), hoy = eqToday_(), recibido = [];
      if (eqStr_(data.nombre)) per.NombreCompleto = eqNoSsn_(eqStr_(data.nombre, 120));
      if (eqStr_(data.telefono)) per.Telefono = eqPhone_(data.telefono);
      if (eqStr_(data.correo)) per.CorreoPersonal = eqNoSsn_(eqStr_(data.correo, 120));
      if (eqStr_(data.direccion)) per.Direccion = eqNoSsn_(eqStr_(data.direccion, 300));
      if (eqStr_(data.emergencia)) per.Emergencia = eqNoSsn_(eqStr_(data.emergencia, 300));
      per.Actualizado = now; eqWrite_(tp, per);
      (data.files || []).slice(0, 8).forEach(function (f) {
        if (['id', 'w4', 'i9', 'deposito', 'oferta'].indexOf(f.tipo) < 0) return;
        eqDocSave_(tp, tpe, td, { personaId: per.ID, periodoId: pe.ID, tipo: f.tipo, nombre: f.nombre, mime: f.mime, b64: f.b64, vence: f.vence },
          'Link de alta', per.NombreCompleto || per.Usuario);
        recibido.push(EQ_TIPOS[f.tipo]);
      });
      var firma = String(data.firma || '');
      if (/^data:image\/png;base64,/.test(firma)) {
        var tx = eqTextos_(), acc = data.acepta || {};
        [['reglas', acc.reglas, tx.reglasEs, tx.reglasEn], ['confidencialidad', acc.conf, tx.confEs, tx.confEn]].forEach(function (x) {
          if (!x[1]) return;
          var pdf = eqAckPdf_(x[0], per, x[2], x[3], firma);
          eqDocSave_(tp, tpe, td, { personaId: per.ID, periodoId: pe.ID, tipo: x[0], nombre: pdf.getName(), mime: 'application/pdf',
            b64: Utilities.base64Encode(pdf.getBytes()) }, 'Link de alta', per.NombreCompleto || per.Usuario);
          var e2 = eqJ_(pe.Entrada); e2[x[0]] = { st: 'ok', f: hoy, por: 'Firmó en el link de alta' }; pe.Entrada = JSON.stringify(e2); eqWrite_(tpe, pe);
          recibido.push(EQ_TIPOS[x[0]] + ' (firmado)');
        });
      }
      var en = eqJ_(pe.Entrada); if (en._link) en._link.hecho = now; pe.Entrada = JSON.stringify(en); pe.Actualizado = now; eqWrite_(tpe, pe);
      eqCacheClear_();
      try {
        var to = Session.getEffectiveUser().getEmail();
        if (to) MailApp.sendEmail(to, '👥 ' + (per.NombreCompleto || per.Usuario) + ' mandó sus papeles de entrada',
          (per.NombreCompleto || per.Usuario) + ' llenó su link de alta.\n\n' +
          (recibido.length ? 'Recibido:\n- ' + recibido.join('\n- ') : 'Solo actualizó sus datos.') +
          '\n\nRevísalo en el Hub → 👥 Equipo → su ficha (los documentos quedan como "Recibido · por revisar" hasta que los marques ✓).');
      } catch (e) {}
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}
function eqAckPdf_(kind, per, es, en, firma) {
  var p = function (s) { return eqEsc_(s).replace(/\n/g, '<br>'); };
  var fecha = Utilities.formatDate(new Date(), eqTz_(), 'MM/dd/yyyy h:mm a');
  var html = '<html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#111;line-height:1.4">' +
    '<div style="border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:12px"><b style="font-size:14pt">MirComm LLC</b><br>' +
    '<span style="font-size:9pt;color:#444">4415 N. Conway Ave., Ste. 180 · Palmhurst, TX 78573 · (956) 603-6505</span></div>' +
    '<div>' + p(es) + '</div><div style="margin-top:14px;color:#333">' + p(en) + '</div>' +
    '<div style="margin-top:22px"><img src="' + firma + '" style="height:60px"><div style="border-top:1px solid #111;width:300px;padding-top:4px">' +
    '<b>' + eqEsc_(per.NombreCompleto || per.Usuario) + '</b><br><span style="font-size:9pt;color:#444">Firmado electrónicamente · Signed electronically · ' + fecha + '</span></div></div>' +
    '</body></html>';
  var name = (kind === 'reglas' ? 'Reglas de la tienda' : 'Acuerdo de confidencialidad') + ' firmado · ' + (per.NombreCompleto || per.Usuario) + '.pdf';
  return Utilities.newBlob(html, 'text/html', 'ack.html').getAs('application/pdf').setName(name);
}
