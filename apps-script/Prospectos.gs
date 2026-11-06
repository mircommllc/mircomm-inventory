/**
 * Prospectos.gs — Registro de prospectos de las asesoras de MirComm (Palmhurst)
 * -----------------------------------------------------------------------------
 * Cada asesora entra con su propio PIN y registra los clientes que consigue por
 * fuera de la tienda (redes sociales, conocidos, llamadas, visitas, etc.).
 * El sistema:
 *   - Pone la fecha y hora de registro desde el servidor (no se puede cambiar).
 *   - Rechaza teléfonos que ya están registrados (activos) por otra asesora.
 *   - Clientes que ya tienen servicio con MirComm SÍ se pueden registrar (oportunidad):
 *     solo internet → ofrecer la línea; ya con línea → traer sus otras líneas (portabilidad).
 *     A esos solo les cuentan las órdenes hechas desde el día del registro.
 *   - Marca si el prospecto ya era cliente de la tienda o de MirComm.
 *   - Lleva la bitácora de contactos (llamadas, mensajes, visitas).
 *   - Da 30 días de plazo desde el registro; cada contacto registrado antes de que
 *     venza extiende el plazo, con un máximo de 60 días.
 *   - Cruza los prospectos con la hoja "Activations" (si existe) y decide si la venta
 *     es Propia ($75), de Tienda ($40) o queda en Revisar para Joel.
 *
 * INSTALACIÓN (una sola vez):
 *  1. Apps Script → + (Add file) → Script → nómbralo "Prospectos" → pega este archivo → Save.
 *  2. En Code.gs, dentro de doGet(e), justo debajo de la línea
 *        var cr = clientesRouter_(e); if (cr) return cr;
 *     agrega esta línea:
 *        var pr = prospectosRouter_(e); if (pr) return pr;
 *  3. Más abajo en ESTE archivo, en configurarProspectos(), cambia los PIN de 6 dígitos
 *     de cada persona. Selecciona configurarProspectos en la barra → Run.
 *  4. (Opcional) Selecciona crearTriggerProspectos → Run, para que el cruce con
 *     Activaciones corra solo cada hora.
 *  5. Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 */

var PROS_SHEET = 'Prospectos';
var PROS_LOG_SHEET = 'Prospectos_Contactos';
var PROS_HEADERS = ['ID', 'Creado', 'Asesora', 'RegistradoPor', 'Nombre', 'Telefono', 'Direccion', 'Zip',
  'Canal', 'Detalle', 'Codigo', 'Interes', 'Notas', 'ProximoSeguimiento', 'Estado', 'VenceEl',
  'UltimoContacto', 'Contactos', 'EraCliente', 'Atribucion', 'AtribucionNota', 'CuentaSpectrum',
  'FechaVenta', 'RepIdVenta', 'FuenteVenta', 'RevisadoPor', 'Actualizado'];
var PROS_LOG_HEADERS = ['Fecha', 'Asesora', 'ProspectoID', 'Nombre', 'Tipo', 'Resultado', 'Nota'];
var PROS_WINDOW_DAYS = 30;   // plazo inicial
var PROS_MAX_DAYS = 60;      // plazo máximo con seguimientos
var PROS_CONTACT_EXTENDS = 30; // cada contacto extiende el plazo hasta X días después del contacto
var PROS_STORE_CHANNEL = 'Seguimiento de tienda';
var PROS_CODE_CHANNEL = 'Código personal';
// v60: personas que ya no trabajan en MirComm. Su historial se queda (prospectos, ventas, nómina),
// pero ya no salen para asignarles prospectos ni para darles crédito de una venta. Lo usa también Credito.gs.
var STAFF_BAJAS = { Alondra: '2026-10-31' };
function staffEsBaja_(name) { return !!STAFF_BAJAS[String(name || '').trim()]; }

// ─── CONFIGURACIÓN (editar y correr una vez) ─────────────────────────
function configurarProspectos() {
  var config = {
    usuarios: {
      // pin: 6 dígitos, distinto para cada persona. codigo: el que ponen en sus publicaciones.
      // repIds: los Rep ID de Spectrum de cada persona.
      Joel:    { pin: '111281', manager: true,  codigo: '',    repIds: ['CMMCL4423'] },
      Lizbeth: { pin: '041723', manager: false, codigo: 'LIZ', repIds: ['CMMLB4896', 'CMMLB4898'] },
      Alondra: { pin: '061903', manager: false, codigo: 'ALO', repIds: ['CMMLB4898'] }
    }
  };
  var seen = {};
  Object.keys(config.usuarios).forEach(function (name) {
    var pin = String(config.usuarios[name].pin);
    if (!/^\d{6}$/.test(pin) || pin === '000000') throw new Error('Pon un PIN de 6 dígitos para ' + name + ' (no 000000).');
    if (seen[pin]) throw new Error('El PIN de ' + name + ' es igual al de ' + seen[pin] + '. Usa PINs distintos.');
    seen[pin] = name;
  });
  PropertiesService.getScriptProperties().setProperty('PROSPECTOS_CONFIG', JSON.stringify(config));
  prosSheet_(); prosLogSheet_();
  Logger.log('Prospectos configurado para: ' + Object.keys(config.usuarios).join(', '));
}

// Cruce automático con Activaciones cada hora (opcional).
function crearTriggerProspectos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cruzarProspectos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cruzarProspectos').timeBased().everyHours(1).create();
  Logger.log('Listo: el cruce con Activaciones corre cada hora.');
}
function cruzarProspectos() { return prosMatchAll_(); }

// ─── ROUTER (se llama desde doGet en Code.gs) ────────────────────────
function prospectosRouter_(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || '');
  if (action.indexOf('pros') !== 0) return null;
  var out;
  try {
    var me = prosAuth_(p);
    switch (action) {
      case 'prosLogin':   out = { ok: true, user: prosPublicUser_(me) }; break;
      case 'prosList':    out = prosList_(me); break;
      case 'prosCheck':   out = prosCheck_(me, p); break;
      case 'prosAdd':     out = prosWithLock_(function () { return prosAdd_(me, p); }); break;
      case 'prosContact': out = prosWithLock_(function () { return prosContact_(me, p); }); break;
      case 'prosUpdate':  out = prosWithLock_(function () { return prosUpdate_(me, p); }); break;
      case 'prosSold':    out = prosWithLock_(function () { return prosSold_(me, p); }); break;
      case 'prosReview':  out = prosWithLock_(function () { return prosReview_(me, p); }); break;
      case 'prosMatch':   prosNeedManager_(me); out = prosMatchAll_(); break;
      case 'prosDelete':  out = prosWithLock_(function () { return prosDelete_(me, p); }); break;
      default: throw new Error('Acción desconocida: ' + action);
    }
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ─── AUTENTICACIÓN ───────────────────────────────────────────────────
function prosConfig_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PROSPECTOS_CONFIG');
  if (!raw) throw new Error('Prospectos no está configurado. Corre configurarProspectos() en Apps Script.');
  return JSON.parse(raw);
}
function prosAuth_(p) {
  var cfg = prosConfig_();
  var name = String(p.user || '');
  var u = cfg.usuarios[name];
  if (!u) throw new Error('Usuario no válido.');
  var cache = CacheService.getScriptCache();
  var key = 'prosfail_' + name;
  var fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new Error('Demasiados intentos con PIN incorrecto. Espera 15 minutos.');
  if (String(p.pin || '') !== String(u.pin)) {
    cache.put(key, String(fails + 1), 900);
    throw new Error('PIN incorrecto.');
  }
  if (fails) cache.remove(key);
  return { name: name, manager: !!u.manager, code: u.codigo || '', repIds: u.repIds || [], cfg: cfg };
}
function prosPublicUser_(me) {
  return { name: me.name, manager: me.manager, code: me.code };
}
function prosNeedManager_(me) {
  if (!me.manager) throw new Error('Solo el manager puede hacer esto.');
}
function prosWithLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ─── HOJAS ───────────────────────────────────────────────────────────
function prosSS_() {
  var id = (typeof SPREADSHEET_ID !== 'undefined' && SPREADSHEET_ID) ? SPREADSHEET_ID
    : '1fYPIQh0j_deGwJ_vj1EG5gWOn1oYX5eiVzW0xqt-fgM';
  return SpreadsheetApp.openById(id);
}
function prosEnsureSheet_(name, headers) {
  var ss = prosSS_();
  var sh = ss.getSheetByName(name);
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
function prosSheet_() { return prosEnsureSheet_(PROS_SHEET, PROS_HEADERS); }
function prosLogSheet_() { return prosEnsureSheet_(PROS_LOG_SHEET, PROS_LOG_HEADERS); }

function prosReadAll_(sh) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0].map(String);
  var rows = [];
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues().forEach(function (v, i) {
      var o = { _row: i + 2 };
      headers.forEach(function (h, j) { if (h) o[h] = v[j]; });
      rows.push(o);
    });
  }
  return { headers: headers, rows: rows };
}
function prosWriteRow_(sh, headers, obj) {
  var vals = headers.map(function (h) { return h && obj[h] !== undefined && obj[h] !== null ? String(obj[h]) : ''; });
  if (obj._row) sh.getRange(obj._row, 1, 1, headers.length).setValues([vals]);
  else sh.appendRow(vals);
}

// ─── FECHAS Y TELÉFONOS ──────────────────────────────────────────────
function prosTz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }
function prosFmt_(d) { return Utilities.formatDate(d, prosTz_(), 'yyyy-MM-dd HH:mm'); }
function prosDay_(d) { return Utilities.formatDate(d, prosTz_(), 'yyyy-MM-dd'); }
function prosParse_(s) {
  if (!s) return null;
  if (Object.prototype.toString.call(s) === '[object Date]') return isNaN(s) ? null : s;
  var t = String(s).trim();
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) { var y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0)); }
  var d = new Date(t);
  return isNaN(d) ? null : d;
}
function prosAddDays_(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
function prosPhone_(v) {
  var d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d.length === 10 ? d : '';
}

// Plazo: 30 días desde el registro; un contacto hecho antes de vencer extiende hasta
// 30 días después de ese contacto, nunca más de 60 días desde el registro.
function prosExpiry_(created, lastContact) {
  var base = prosAddDays_(created, PROS_WINDOW_DAYS);
  var cap = prosAddDays_(created, PROS_MAX_DAYS);
  var exp = base;
  if (lastContact) {
    var ext = prosAddDays_(lastContact, PROS_CONTACT_EXTENDS);
    if (ext > exp) exp = ext;
  }
  return exp > cap ? cap : exp;
}
function prosIsExpired_(r, now) {
  var v = prosParse_(r.VenceEl);
  return !!v && now > v && r.Estado !== 'Vendido';
}
// Un prospecto "bloquea" el teléfono mientras está activo (no vencido, no perdido).
function prosIsActive_(r, now) {
  return r.Estado !== 'Perdido' && r.Estado !== 'Vendido' && !prosIsExpired_(r, now);
}

// ─── BÚSQUEDA DE TELÉFONOS EN OTRAS HOJAS ────────────────────────────
function prosFindHeader_(headers, re, notRe) {
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (h && re.test(h) && !(notRe && notRe.test(h))) return h;
  }
  return '';
}
function prosCustomerPhones_() {
  var ss = prosSS_(), set = {};
  ss.getSheets().forEach(function (sh) {
    if (!/^customers/i.test(sh.getName())) return;
    var data = prosReadAll_(sh);
    var ph = prosFindHeader_(data.headers, /phone|tel/i, /spectrum/i);
    if (!ph) return;
    data.rows.forEach(function (r) { var d = prosPhone_(r[ph]); if (d) set[d] = r; });
  });
  return set;
}
// Lee la hoja "Activations" (módulo Activaciones). Si no existe, regresa [].
function prosActivations_() {
  var sh = prosSS_().getSheetByName('Activations');
  if (!sh) return [];
  var data = prosReadAll_(sh), H = data.headers;
  var col = {
    phone: prosFindHeader_(H, /phone|tel/i),
    date: prosFindHeader_(H, /^(order|sale|sold).*date|^date$|fecha.*(venta|orden)|^fecha$/i) ||
          prosFindHeader_(H, /date|fecha/i, /import|connect|disconn|updat|install|survival|paid|pago/i),
    rep: prosFindHeader_(H, /rep/i, /report/i),
    account: prosFindHeader_(H, /account/i, /name|holder|type/i),
    name: prosFindHeader_(H, /customer|cliente|^name$|nombre/i, /phone|email|tel|id$/i)
  };
  var mob = ['MobileLines', 'LinePhones', 'MobileOrder'].filter(function (h) { return H.indexOf(h) >= 0; });
  return data.rows.map(function (r) {
    return {
      mobile: mob.some(function (h) { var v = String(r[h] || '').trim(); return h === 'MobileLines' ? Number(v) > 0 : !!v; }),
      phone: prosPhone_(r[col.phone]),
      date: prosParse_(r[col.date]),
      rep: String(r[col.rep] || '').trim().toUpperCase(),
      account: String(r[col.account] || '').replace(/[^\dA-Za-z]/g, ''),
      name: String(r[col.name] || '')
    };
  }).filter(function (a) { return a.phone || a.account; });
}

// ─── ACCIONES ────────────────────────────────────────────────────────
function prosList_(me) {
  var now = new Date();
  var all = prosReadAll_(prosSheet_()).rows;
  var mine = me.manager ? all : all.filter(function (r) { return r.Asesora === me.name; });
  var logs = prosReadAll_(prosLogSheet_()).rows;
  var since = prosAddDays_(now, -62);
  logs = logs.filter(function (l) {
    var d = prosParse_(l.Fecha);
    return (me.manager || l.Asesora === me.name) && d && d >= since;
  });
  var prospects = mine.map(function (r) { return prosClient_(r, now, me); });
  var users = me.manager ? Object.keys(me.cfg.usuarios).map(function (n) {
    var u = me.cfg.usuarios[n]; return { name: n, code: u.codigo || '', manager: !!u.manager, repIds: u.repIds || [], baja: staffEsBaja_(n) };
  }) : [];
  return {
    me: prosPublicUser_(me),
    now: prosFmt_(now),
    prospects: prospects,
    contacts: logs.map(function (l) { delete l._row; return l; }),
    users: users,
    rules: { window: PROS_WINDOW_DAYS, max: PROS_MAX_DAYS }
  };
}
function prosClient_(r, now, me) {
  var o = {};
  PROS_HEADERS.forEach(function (h) { o[h] = r[h] || ''; });
  o.Vencido = prosIsExpired_(r, now);
  return o;
}

// Revisa un teléfono antes de registrarlo (para avisar en el formulario).
function prosCheck_(me, p) {
  var phone = prosPhone_(p.telefono);
  if (!phone) return { ok: false, message: 'Escribe un teléfono de 10 dígitos.' };
  var res = prosDupCheck_(me, phone, me.name);
  return res;
}
function prosDupCheck_(me, phone, owner) {
  var now = new Date();
  var rows = prosReadAll_(prosSheet_()).rows.filter(function (r) { return prosPhone_(r.Telefono) === phone; });
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.Estado === 'Vendido') continue;   // ya compró antes: se puede volver a trabajar (abajo se avisa)
    if (prosIsActive_(r, now)) {
      if (r.Asesora === owner) return { ok: false, message: 'Este prospecto ya está registrado a tu nombre.', id: r.ID };
      return { ok: false, message: me.manager
        ? 'Ya está registrado por ' + r.Asesora + ' (vence ' + r.VenceEl + ').'
        : 'Este cliente ya está registrado. No se puede registrar de nuevo.' };
    }
  }
  // Ya tiene servicio con MirComm: no se bloquea, es oportunidad (línea gratis → después portar sus otras líneas).
  var acts = prosActivations_();
  var accts = {};
  acts.forEach(function (a) { if (a.phone === phone && a.account) accts[a.account] = 1; });
  var mine = acts.filter(function (a) { return a.phone === phone || (a.account && accts[a.account]); });
  var sold = rows.some(function (r) { return r.Estado === 'Vendido'; });
  if (mine.length || sold) {
    var conLinea = mine.some(function (a) { return a.mobile; });
    var last = mine.filter(function (a) { return a.account; }).sort(function (a, b) { return (b.date || 0) - (a.date || 0); })[0];
    return { ok: true, eraCliente: true, mircomm: conLinea ? 'linea' : 'internet', account: last ? last.account : '',
      message: conLinea
        ? 'Cliente MirComm que ya tiene línea: oportunidad de traer sus otras líneas. Puedes registrarlo; solo cuentan las órdenes desde hoy.'
        : 'Cliente MirComm con internet, sin línea: oportunidad de línea. Puedes registrarlo; solo cuentan las órdenes desde hoy.' };
  }
  var customers = prosCustomerPhones_();
  if (customers[phone]) {
    return { ok: true, eraCliente: true,
      message: 'Ya es cliente de la tienda. Puedes registrarlo, pero Joel revisará si la venta cuenta como propia.' };
  }
  return { ok: true };
}

function prosAdd_(me, p) {
  var now = new Date();
  var nombre = String(p.nombre || '').trim();
  var phone = prosPhone_(p.telefono);
  var canal = String(p.canal || '').trim();
  if (!nombre) throw new Error('Falta el nombre.');
  if (!phone) throw new Error('El teléfono debe tener 10 dígitos.');
  if (!canal) throw new Error('Indica de dónde salió el prospecto.');

  // Dueño del prospecto: la asesora que lo registra; si llegó con código personal,
  // la dueña del código. El manager puede asignarlo a cualquiera.
  var owner = me.name;
  var codigo = String(p.codigo || '').trim().toUpperCase();
  if (canal === PROS_CODE_CHANNEL) {
    if (!codigo) throw new Error('Escribe el código que mencionó el cliente.');
    owner = '';
    Object.keys(me.cfg.usuarios).forEach(function (n) {
      if (String(me.cfg.usuarios[n].codigo || '').toUpperCase() === codigo) owner = n;
    });
    if (!owner) throw new Error('El código ' + codigo + ' no existe.');
  } else if (me.manager && p.asesora && me.cfg.usuarios[p.asesora]) {
    owner = String(p.asesora);
  }
  if (staffEsBaja_(owner)) throw new Error(owner + ' ya no trabaja en MirComm. Ponlo a nombre de alguien más.');

  var check = prosDupCheck_(me, phone, owner);
  if (!check.ok) throw new Error(check.message);

  var preset = '', presetNote = '';
  if (canal === PROS_STORE_CHANNEL) { preset = 'Tienda'; presetNote = 'Cliente que vino a la tienda.'; }

  var sh = prosSheet_();
  var headers = prosReadAll_(sh).headers;
  var row = {
    ID: 'P' + Utilities.formatDate(now, prosTz_(), 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10),
    Creado: prosFmt_(now),
    Asesora: owner,
    RegistradoPor: me.name,
    Nombre: nombre,
    Telefono: phone,
    Direccion: String(p.direccion || '').trim(),
    Zip: String(p.zip || '').replace(/\D/g, '').slice(0, 5),
    Canal: canal,
    Detalle: String(p.detalle || '').trim(),
    Codigo: codigo,
    Interes: String(p.interes || '').trim(),
    Notas: String(p.notas || '').trim(),
    ProximoSeguimiento: String(p.proximo || '').trim(),
    Estado: 'Nuevo',
    VenceEl: prosFmt_(prosExpiry_(now, null)),
    UltimoContacto: '',
    Contactos: '0',
    EraCliente: check.mircomm ? (check.mircomm === 'linea' ? 'MirComm (con línea)' : 'MirComm (sin línea)') : (check.eraCliente ? 'Sí' : ''),
    CuentaSpectrum: check.account || '',
    Atribucion: preset,
    AtribucionNota: presetNote,
    Actualizado: prosFmt_(now)
  };
  prosWriteRow_(sh, headers, row);
  return { ok: true, prospect: prosClient_(row, now, me), warning: check.eraCliente ? check.message : '' };
}

function prosGet_(id) {
  var sh = prosSheet_();
  var data = prosReadAll_(sh);
  var r = data.rows.filter(function (x) { return x.ID === id; })[0];
  if (!r) throw new Error('No encontré ese prospecto.');
  return { sh: sh, headers: data.headers, row: r };
}
function prosOwnerOrManager_(me, r) {
  if (!me.manager && r.Asesora !== me.name) throw new Error('Este prospecto no es tuyo.');
}

function prosContact_(me, p) {
  var now = new Date();
  var g = prosGet_(String(p.id || ''));
  var r = g.row;
  prosOwnerOrManager_(me, r);
  var tipo = String(p.tipo || '').trim();
  if (!tipo) throw new Error('Indica el tipo de contacto.');
  var wasExpired = prosIsExpired_(r, now);
  prosWriteRow_(prosLogSheet_(), PROS_LOG_HEADERS, {
    Fecha: prosFmt_(now), Asesora: me.name, ProspectoID: r.ID, Nombre: r.Nombre,
    Tipo: tipo, Resultado: String(p.resultado || '').trim(), Nota: String(p.nota || '').trim()
  });
  r.UltimoContacto = prosFmt_(now);
  r.Contactos = String((parseInt(r.Contactos, 10) || 0) + 1);
  if (r.Estado === 'Nuevo') r.Estado = 'En seguimiento';
  if (p.proximo !== undefined) r.ProximoSeguimiento = String(p.proximo || '');
  // Solo un contacto hecho ANTES de vencer extiende el plazo.
  if (!wasExpired) r.VenceEl = prosFmt_(prosExpiry_(prosParse_(r.Creado), now));
  r.Actualizado = prosFmt_(now);
  prosWriteRow_(g.sh, g.headers, r);
  return { ok: true, prospect: prosClient_(r, now, me), expired: wasExpired };
}

function prosUpdate_(me, p) {
  var now = new Date();
  var g = prosGet_(String(p.id || ''));
  var r = g.row;
  prosOwnerOrManager_(me, r);
  var prevOwner = r.Asesora;
  if (me.manager && p.Asesora !== undefined && !me.cfg.usuarios[String(p.Asesora).trim()]) throw new Error('Ese usuario no existe en Prospectos.');
  if (me.manager && p.Asesora !== undefined && String(p.Asesora).trim() !== prevOwner && staffEsBaja_(p.Asesora))
    throw new Error(String(p.Asesora).trim() + ' ya no trabaja en MirComm.');
  var repFields = ['Direccion', 'Zip', 'Interes', 'Notas', 'ProximoSeguimiento'];
  var mgrFields = repFields.concat(['Nombre', 'Telefono', 'Canal', 'Detalle', 'Asesora', 'Estado', 'VenceEl']);
  (me.manager ? mgrFields : repFields).forEach(function (f) {
    if (p[f] !== undefined) r[f] = String(p[f]).trim();
  });
  if (r.Telefono) r.Telefono = prosPhone_(r.Telefono) || r.Telefono;
  // La asesora solo puede cambiar el estado a Perdido o regresarlo a En seguimiento.
  if (!me.manager && p.Estado !== undefined) {
    if (p.Estado === 'Perdido' || (p.Estado === 'En seguimiento' && r.Estado === 'Perdido' && !prosIsExpired_(r, now))) {
      r.Estado = p.Estado;
    } else {
      throw new Error('Ese cambio de estado lo hace Joel.');
    }
  }
  r.Actualizado = prosFmt_(now);
  prosWriteRow_(g.sh, g.headers, r);
  var moved = r.Asesora !== prevOwner ? prosMoveTasks_(r.ID, r.Asesora) : 0;
  return { ok: true, prospect: prosClient_(r, now, me), tareasMovidas: moved };
}
// v59: si Joel cambia el dueño del prospecto, sus seguimientos pendientes (Seg_Tareas) se van con él.
function prosMoveTasks_(id, owner) {
  if (typeof segRead_ !== 'function' || typeof SEG_TASK_SHEET === 'undefined') return 0;
  var t = segRead_(SEG_TASK_SHEET, SEG_TASK_HEADERS), n = 0;
  t.rows.forEach(function (x) {
    if (x.ProspectoID === id && x.Estado === 'Pendiente' && x.Asesora !== owner) { x.Asesora = owner; segWrite_(t, x); n++; }
  });
  return n;
}

// La asesora avisa que el prospecto contrató (con número de cuenta si lo tiene).
// Queda "Vendido" y se evalúa: si la orden aparece en Activaciones se decide solo;
// si no, queda en Revisar para Joel.
function prosSold_(me, p) {
  var now = new Date();
  var g = prosGet_(String(p.id || ''));
  var r = g.row;
  prosOwnerOrManager_(me, r);
  if (r.Estado === 'Vendido' && r.RevisadoPor) throw new Error('Este prospecto ya fue revisado.');
  r.CuentaSpectrum = String(p.cuenta || r.CuentaSpectrum || '').replace(/[^\dA-Za-z]/g, '');
  r.FechaVenta = String(p.fecha || prosDay_(now));
  r.Estado = 'Vendido';
  r.Actualizado = prosFmt_(now);
  var acts = prosActivations_();
  var act = prosFindActivation_(r, acts);
  prosEvaluate_(r, act ? { date: act.date, rep: act.rep, account: act.account, source: 'Activaciones' }
                       : { date: prosParse_(r.FechaVenta), rep: '', account: r.CuentaSpectrum, source: 'Asesora' }, me.cfg);
  prosWriteRow_(g.sh, g.headers, r);
  return { ok: true, prospect: prosClient_(r, now, me) };
}

function prosReview_(me, p) {
  prosNeedManager_(me);
  var now = new Date();
  var g = prosGet_(String(p.id || ''));
  var r = g.row;
  var a = String(p.atribucion || '');
  if (['Propia', 'Tienda', 'Rechazada'].indexOf(a) < 0) throw new Error('Atribución no válida.');
  r.Atribucion = a;
  if (p.nota !== undefined) r.AtribucionNota = String(p.nota || '');
  r.RevisadoPor = me.name + ' · ' + prosFmt_(now);
  if (a !== 'Rechazada') r.Estado = 'Vendido';
  r.Actualizado = prosFmt_(now);
  prosWriteRow_(g.sh, g.headers, r);
  return { ok: true, prospect: prosClient_(r, now, me) };
}

function prosDelete_(me, p) {
  prosNeedManager_(me);
  var g = prosGet_(String(p.id || ''));
  g.sh.deleteRow(g.row._row);
  return { ok: true };
}

// ─── CRUCE CON ACTIVACIONES ──────────────────────────────────────────
function prosFindActivation_(r, acts) {
  var phone = prosPhone_(r.Telefono);
  var acct = String(r.CuentaSpectrum || '').replace(/[^\dA-Za-z]/g, '');
  var created = prosParse_(r.Creado);
  var onlyNew = /^MirComm/.test(String(r.EraCliente || '')) && created;   // ya era cliente MirComm
  var best = null;
  acts.forEach(function (a) {
    var hit = (phone && a.phone === phone) || (acct && a.account && a.account === acct);
    if (!hit) return;
    // Cliente MirComm: sus órdenes viejas no cuentan, solo las del día del registro en adelante.
    if (onlyNew && (!a.date || prosDay_(a.date) < prosDay_(created))) return;
    // La orden más cercana después del registro; si no hay, la más reciente.
    if (!best) { best = a; return; }
    var aAfter = a.date && created && a.date >= created, bAfter = best.date && created && best.date >= created;
    if (aAfter && !bAfter) best = a;
    else if (aAfter === bAfter && a.date && best.date && (aAfter ? a.date < best.date : a.date > best.date)) best = a;
  });
  return best;
}

// Decide la atribución de una venta. No toca lo que Joel ya revisó.
function prosEvaluate_(r, sale, cfg) {
  if (r.RevisadoPor) return;
  r.FuenteVenta = sale.source;
  if (sale.date) r.FechaVenta = prosDay_(sale.date);
  if (sale.rep) r.RepIdVenta = sale.rep;
  if (sale.account) r.CuentaSpectrum = sale.account;
  var created = prosParse_(r.Creado);
  var vence = prosParse_(r.VenceEl);
  var saleDay = sale.date ? prosDay_(sale.date) : '';
  var createdDay = created ? prosDay_(created) : '';
  var owner = cfg.usuarios[r.Asesora] || {};
  var ownerReps = (owner.repIds || []).map(function (x) { return String(x).toUpperCase(); });

  if (r.Canal === PROS_STORE_CHANNEL) { r.Atribucion = 'Tienda'; r.AtribucionNota = 'Cliente que vino a la tienda.'; return; }
  if (!saleDay) { r.Atribucion = 'Revisar'; r.AtribucionNota = 'No se conoce la fecha de la venta.'; return; }
  if (saleDay < createdDay) { r.Atribucion = 'Tienda'; r.AtribucionNota = 'Se registró después de la venta.'; return; }
  if (vence && saleDay > prosDay_(vence)) { r.Atribucion = 'Tienda'; r.AtribucionNota = 'La venta fue después de que venció el plazo.'; return; }
  var notes = [];
  if (saleDay === createdDay) notes.push('Se registró el mismo día de la venta.');
  if (sale.rep && ownerReps.indexOf(sale.rep) < 0) {
    notes.push(ownerReps.length ? 'La orden se hizo con el Rep ID ' + sale.rep + ', no con el de ' + r.Asesora + '.'
      : 'La orden se hizo con el Rep ID ' + sale.rep + ' y ' + r.Asesora + ' no tiene Rep ID configurado.');
  }
  if (/^MirComm/.test(String(r.EraCliente || ''))) notes.push('Ya era cliente ' + r.EraCliente + '; revisa que sea un servicio nuevo.');
  else if (r.EraCliente) notes.push('Ya era cliente de la tienda.');
  if (r.Canal === PROS_CODE_CHANNEL) notes.push('Llegó con el código ' + (r.Codigo || '') + '.');
  if (sale.source !== 'Activaciones') notes.push('La reportó la asesora; falta que aparezca en Activaciones.');
  if (notes.length) { r.Atribucion = 'Revisar'; r.AtribucionNota = notes.join(' '); return; }
  r.Atribucion = 'Propia';
  r.AtribucionNota = 'Registrado ' + createdDay + ', venta ' + saleDay + '.';
}

function prosMatchAll_() {
  var now = new Date();
  var cfg = prosConfig_();
  var acts = prosActivations_();
  var sh = prosSheet_();
  var data = prosReadAll_(sh);
  var updated = 0, matched = 0;
  var byPhone = {};
  data.rows.forEach(function (r) { var ph = prosPhone_(r.Telefono); if (ph) (byPhone[ph] = byPhone[ph] || []).push(r); });
  data.rows.forEach(function (r) {
    if (r.RevisadoPor) return;
    var act = prosFindActivation_(r, acts);
    if (!act) return;
    var created = prosParse_(r.Creado);
    // Si el mismo teléfono se registró otra vez después (el primero venció), la venta
    // le toca al registro más reciente que sea anterior a la venta.
    var newer = (byPhone[prosPhone_(r.Telefono)] || []).some(function (o) {
      var oc = prosParse_(o.Creado);
      return o !== r && oc && created && oc > created && (!act.date || prosDay_(oc) <= prosDay_(act.date));
    });
    if (newer) return;
    // Ignora órdenes de más de 60 días antes del registro (clientes viejos con otra cuenta).
    if (act.date && created && act.date < prosAddDays_(created, -60)) return;
    matched++;
    var before = r.Atribucion + '|' + r.FechaVenta + '|' + r.RepIdVenta + '|' + r.FuenteVenta;
    r.Estado = 'Vendido';
    prosEvaluate_(r, { date: act.date, rep: act.rep, account: act.account, source: 'Activaciones' }, cfg);
    if (before !== r.Atribucion + '|' + r.FechaVenta + '|' + r.RepIdVenta + '|' + r.FuenteVenta) {
      r.Actualizado = prosFmt_(now);
      prosWriteRow_(sh, data.headers, r);
      updated++;
    }
  });
  return { ok: true, activations: acts.length, matched: matched, updated: updated,
    message: acts.length ? '' : 'No encontré la hoja Activations (módulo Activaciones). El cruce automático empieza cuando esté instalado.' };
}
