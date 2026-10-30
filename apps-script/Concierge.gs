/**
 * Concierge.gs — 🏡 Concierge (ConnectRGV) dentro del Hub
 *
 * Lee las solicitudes que llegan de connectrgv.com a la hoja "ConnectRGV -Solicitudes"
 * (pestañas Clientes de socios, Familias y Socios) y les da seguimiento desde el Hub:
 *   Nuevo → Contactado → Servicios elegidos → Instalado   (o "No avanzó")
 * En cada paso se puede avisar solo al socio que refirió (correo desde tu cuenta, a nombre de ConnectRGV).
 * Cuando el cliente elige internet de Spectrum, AT&T, Viasat o Tracfone, el referido aparece solo
 * en 🤝 Socios (como lead) y al quedar instalado pasa a venta, para que la comisión del socio salga sola.
 *
 * No se borra ni se mueve ninguna columna de la hoja: las nuevas se agregan al final y una pestaña
 * nueva "Directorio" guarda cómo llegan marcados los clientes de cada socio, su idioma y si quiere avisos.
 * El CORREO del socio vive en su perfil de 🤝 Socios (columna "email" de Partners): se escribe ahí una sola vez
 * y lo usan los avisos. Solo los socios que todavía no están en 🤝 Socios guardan el correo en el Directorio.
 * El formulario del sitio sigue igual; no hay que tocar el Apps Script de ConnectRGV.
 *
 * Usa: isManagerToken_ (Activaciones.gs), adminMe_ / adminFirma_ (Admins.gs),
 *      socRead_ / socSaveReferral_ / socSavePartner_ / socRecalc_ (Socios.gs).
 *
 * INSTALAR (una vez):
 *  1. Apps Script del Hub: ＋ → Script → nómbralo "Concierge" → pega todo este archivo → Guardar.
 *  2. En Code.gs, dentro de function hubGet_(e), pega esta línea JUSTO DEBAJO de  prosSessionPin_(e);
 *        var cg = conciergeRouter_(e); if (cg) return cg;
 *  3. Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *     Google va a pedir permiso para abrir la hoja de ConnectRGV: acéptalo.
 */

// ─── CONFIGURACIÓN ─────────────────────────────────────────────────
var CGV_SHEET_ID = '1K2j6EuKL0unPsqv3F9JJZ0UBWQGFb9CZ903IUMYOI0E';   // ConnectRGV -Solicitudes
var CGV_TZ = 'America/Chicago';
var CGV_PHONE = '(956) 467-6695';
var CGV_REPLY_TO = 'mircommllc@gmail.com';
var CGV_TABS = { cliente: 'Clientes de socios', familia: 'Familias', socio: 'Socios' };
var CGV_PREFIX = { cliente: 'C', familia: 'F', socio: 'S' };
var CGV_EXTRA = ['ID', 'Servicios elegidos', 'Notas', 'Historial', 'Intentos', 'Primer contacto', 'Actualizado', 'Atendió',
  'Socio ID', 'Referido ID'];
var CGV_DIR_TAB = 'Directorio';
var CGV_DIR_HEADERS = ['Clave', 'Socio ID', 'Nombre', 'Empresa', 'Correo', 'Telefono', 'Idioma', 'Avisos', 'Pagina', 'Actualizado', 'Foto', 'Publicada'];
var CGV_SITE = 'connectrgv.com';
// Direcciones que ya usa el sitio (no se le pueden dar a un socio)
var CGV_RESERVED = ['socios', 'socio', 'ejemplo', 'assets', 'index', 'sitemap', 'robots', 'gracias', 'admin', 'wp-admin', 'cgi-bin', 'familias', 'contacto'];
var CGV_ST_CLIENTE = ['Nuevo', 'Contactado', 'Servicios elegidos', 'Instalado', 'No avanzó'];
var CGV_ST_SOCIO = ['Nuevo', 'Contactado', 'Reunión', 'Dado de alta', 'No avanzó'];
var CGV_AVISO_ST = { 'Contactado': 1, 'Servicios elegidos': 1, 'Instalado': 1 };   // pasos que se le avisan al socio
var CGV_SERVICIOS = ['Internet', 'Luz', 'Celular', 'TV'];
var CGV_ACTIONS = { cgvList: 1, cgvAvisoGet: 1, cgvSave: 1, cgvDirSave: 1, cgvPartnerCreate: 1, cgvPartnerEmail: 1, cgvPageGet: 1, cgvPageSave: 1, cgvKitMail: 1 };

// Nombre de columna en la hoja → nombre en el Hub
var CGV_MAP = {
  'Recibido': 'recibido', 'Nombre': 'nombre', 'Teléfono': 'telefono', 'Correo': 'correo', 'Empresa': 'empresa',
  'Tipo de socio': 'tipoSocio', 'Mudanzas al mes': 'volumen', 'Socio que refirió': 'socio', 'Fecha de mudanza': 'mudanza',
  'Dirección': 'direccion', 'Código postal': 'zip', 'Cuándo se muda': 'cuando', 'Servicios': 'servicios', 'Página': 'pagina',
  'Estatus': 'estatus', 'ID': 'id', 'Servicios elegidos': 'elegidos', 'Notas': 'notas', 'Historial': 'historial',
  'Intentos': 'intentos', 'Primer contacto': 'primerContacto', 'Actualizado': 'actualizado', 'Atendió': 'atendio',
  'Socio ID': 'socioId', 'Referido ID': 'refId'
};

// ─── ROUTER ────────────────────────────────────────────────────────
// En Code.gs → hubGet_(e), justo debajo de prosSessionPin_(e):
//   var cg = conciergeRouter_(e); if (cg) return cg;
function conciergeRouter_(e) {
  var p = {}, src = (e && e.parameter) || {};
  for (var k in src) p[k] = src[k];
  if (e && e.postData && e.postData.contents) {
    try { var b = JSON.parse(e.postData.contents); for (var j in b) p[j] = b[j]; } catch (x) {}
  }
  var a = String(p.action || '');
  if (!CGV_ACTIONS[a]) return null;
  cgvAuditLabels_();
  cgvSocEmailCol_();
  var out;
  try {
    if (!(typeof isManagerToken_ === 'function' && isManagerToken_(p.mt))) {
      out = { error: 'Tu sesión venció. Entra otra vez con tu PIN.', code: 'AUTH' };
    } else if (a === 'cgvList') out = cgvList_();
    else if (a === 'cgvAvisoGet') out = cgvAvisoGet_(cgvJson_(p.data) || p);
    else if (a === 'cgvPageGet') out = cgvPageGet_(cgvJson_(p.data) || p);
    else out = cgvLock_(function () {
      var d = cgvJson_(p.data) || {};
      if (a === 'cgvSave') return cgvSave_(d);
      if (a === 'cgvDirSave') return cgvDirSave_(d);
      if (a === 'cgvPartnerCreate') return cgvPartnerCreate_(d);
      if (a === 'cgvPartnerEmail') return cgvPartnerEmail_(d);
      if (a === 'cgvPageSave') return cgvPageSave_(d);
      if (a === 'cgvKitMail') return cgvKitMail_(d);
    });
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Nombres legibles en 🧾 Historial de cambios (Admins.gs los usa al terminar la llamada)
function cgvAuditLabels_() {
  try {
    if (typeof AUD_LABELS === 'object' && AUD_LABELS) {
      AUD_LABELS.cgvSave = 'Concierge: actualizó solicitud';
      AUD_LABELS.cgvDirSave = 'Concierge: guardó datos de socio';
      AUD_LABELS.cgvPartnerCreate = 'Concierge: dio de alta socio';
      AUD_LABELS.cgvPartnerEmail = 'Socios: cambió correo del socio';
      AUD_LABELS.cgvPageSave = 'Concierge: guardó página del socio';
      AUD_LABELS.cgvKitMail = 'Concierge: mandó kit al socio';
    }
  } catch (e) {}
}
function cgvLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function cgvJson_(v) {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}
function cgvMe_() { return typeof adminMe_ === 'function' ? adminMe_() : 'Joel'; }
function cgvFirmaName_() {
  try { if (typeof adminFirma_ === 'function') { var n = String(adminFirma_().split('\n')[0] || '').trim(); if (n) return n; } } catch (e) {}
  return cgvMe_() === 'Joel' ? 'Joel Chavez' : cgvMe_();
}
function cgvNow_() { return new Date().toISOString(); }
function cgvToday_() { return Utilities.formatDate(new Date(), CGV_TZ, 'yyyy-MM-dd'); }
function cgvYmd_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, CGV_TZ, 'yyyy-MM-dd');
  var s = String(v || '').trim(), m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return s;
}
function cgvDigits_(v) { return String(v || '').replace(/\D/g, '').slice(-10); }
function cgvNorm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function cgvFirst_(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
function cgvSafe_(v, max) {
  v = String(v === undefined || v === null ? '' : v).trim().slice(0, max || 500);
  return /^[=+\-@]/.test(v) ? "'" + v : v;   // que nada entre a la hoja como fórmula
}

// ─── HOJAS ─────────────────────────────────────────────────────────
var CGV_C_ = {};
function cgvSS_() { return CGV_C_.ss || (CGV_C_.ss = SpreadsheetApp.openById(CGV_SHEET_ID)); }
// Abre la pestaña y agrega al final las columnas que falten. Las pestañas del sitio no se crean aquí (las crea el formulario).
function cgvTab_(name, extra, createWith) {
  if (CGV_C_['t_' + name]) return CGV_C_['t_' + name];
  var ss = cgvSS_(), sh = ss.getSheetByName(name);
  if (!sh) {
    if (!createWith) return null;
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, createWith.length).setValues([createWith]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var lc = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h || '').trim(); });
  while (head.length && !head[head.length - 1]) head.pop();
  var missing = (extra || []).filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    head = head.concat(missing);
  }
  CGV_C_['t_' + name] = { sh: sh, head: head };
  return CGV_C_['t_' + name];
}
function cgvCell_(h, x) {
  if (x === null || x === undefined) return '';
  if (x instanceof Date) {
    if (isNaN(x)) return '';
    return (h === 'Recibido' || h === 'Primer contacto' || h === 'Actualizado') ? x.toISOString() : cgvYmd_(x);
  }
  if (typeof x === 'number' && (h === 'Teléfono' || h === 'Telefono')) return String(Math.round(x));
  return String(x);
}

// Lee una pestaña de solicitudes. Las filas sin ID reciben uno (se guarda en la hoja para que no cambie).
function cgvRead_(tipo) {
  var t = cgvTab_(CGV_TABS[tipo], CGV_EXTRA, null);
  if (!t) return [];
  var lr = t.sh.getLastRow();
  if (lr < 2) return [];
  var vals = t.sh.getRange(2, 1, lr - 1, t.head.length).getValues();
  var cId = t.head.indexOf('ID'), cRec = t.head.indexOf('Recibido'), fix = false;
  var ids = vals.map(function (r) { return [r[cId]]; });
  var out = [];
  vals.forEach(function (r, i) {
    if (r.every(function (c) { return c === '' || c === null; })) return;
    if (!r[cId]) {
      var rec = r[cRec] instanceof Date ? r[cRec] : new Date();
      r[cId] = CGV_PREFIX[tipo] + Utilities.formatDate(rec, CGV_TZ, 'yyMMddHHmmss') + '-' + (i + 2);
      ids[i][0] = r[cId]; fix = true;
    }
    var o = { _row: i + 2, tipo: tipo };
    t.head.forEach(function (h, c) { if (h) o[CGV_MAP[h] || h] = cgvCell_(h, r[c]); });
    o.estatus = o.estatus || 'Nuevo';
    o.elegidos = cgvParseArr_(o.elegidos);
    o.historial = cgvParseArr_(o.historial);
    o.intentos = Number(o.intentos) || 0;
    out.push(o);
  });
  if (fix) t.sh.getRange(2, cId + 1, ids.length, 1).setNumberFormat('@').setValues(ids);
  return out;
}
function cgvParseArr_(v) {
  if (Array.isArray(v)) return v;
  try { var a = JSON.parse(String(v || '') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
// Escribe solo las celdas que cambian (por nombre de columna)
function cgvWrite_(tipo, row, changes) {
  var t = cgvTab_(CGV_TABS[tipo], CGV_EXTRA, null);
  Object.keys(changes).forEach(function (h) {
    var c = t.head.indexOf(h);
    if (c < 0) return;
    var v = changes[h];
    if (Array.isArray(v) || (v && typeof v === 'object')) v = JSON.stringify(v);
    var cell = t.sh.getRange(row, c + 1);
    if (h === 'Socio ID' || h === 'Referido ID' || h === 'ID') cell.setNumberFormat('@');
    cell.setValue(v);
  });
}
function cgvFind_(tipo, id) {
  if (!CGV_TABS[tipo]) throw new Error('Tipo de solicitud desconocido.');
  var r = cgvRead_(tipo).filter(function (x) { return String(x.id) === String(id); })[0];
  if (!r) throw new Error('No encontré esa solicitud. Actualiza la página.');
  return r;
}

// ─── DIRECTORIO DE SOCIOS (para los avisos) ────────────────────────
// El correo de un socio ligado sale de su perfil en 🤝 Socios (correoDe: 'socio'); si no está ligado, del Directorio.
function cgvDirRead_(raw) {
  var list = cgvDirReadRaw_();
  if (raw) return list;
  var P = {};
  if (list.some(function (d) { return d.socioId; })) cgvPartners_().forEach(function (p) { P[p.id] = p; });
  list.forEach(function (d) {
    var p = d.socioId && P[d.socioId];
    d.correoDe = p ? 'socio' : 'dir';
    if (p) { d.correo = p.email || ''; if (!d.telefono && p.phone) d.telefono = p.phone; }
  });
  return list;
}
function cgvDirReadRaw_() {
  var t = cgvTab_(CGV_DIR_TAB, CGV_DIR_HEADERS, CGV_DIR_HEADERS), lr = t.sh.getLastRow();
  if (lr < 2) return [];
  return t.sh.getRange(2, 1, lr - 1, t.head.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    t.head.forEach(function (h, c) { if (h) o[h] = cgvCell_(h, r[c]); });
    return {
      _row: o._row, clave: o.Clave, socioId: o['Socio ID'], nombre: o.Nombre, empresa: o.Empresa, correo: o.Correo,
      telefono: o.Telefono, idioma: o.Idioma === 'EN' ? 'EN' : 'ES', avisos: o.Avisos !== 'No', pagina: o.Pagina, actualizado: o.Actualizado,
      foto: o.Foto || '', publicada: o.Publicada === 'Sí'
    };
  }).filter(function (d) { return d.clave; });
}
// Escribe un renglón del Directorio. Lo que no venga en d (undefined) se queda como estaba (foto, página publicada…).
var CGV_DIR_F = { 'Clave': 'clave', 'Socio ID': 'socioId', 'Nombre': 'nombre', 'Empresa': 'empresa', 'Correo': 'correo', 'Telefono': 'telefono',
  'Idioma': 'idioma', 'Avisos': 'avisos', 'Pagina': 'pagina', 'Foto': 'foto', 'Publicada': 'publicada' };
function cgvDirWrite_(d) {
  var t = cgvTab_(CGV_DIR_TAB, CGV_DIR_HEADERS, CGV_DIR_HEADERS);
  var row = d._row || Math.max(t.sh.getLastRow(), 1) + 1;
  var prev = d._row ? t.sh.getRange(row, 1, 1, t.head.length).getValues()[0] : [];
  var vals = t.head.map(function (h, c) {
    if (h === 'Actualizado') return cgvNow_();
    var k = CGV_DIR_F[h];
    if (!k || d[k] === undefined) return prev[c] === undefined || prev[c] === null ? '' : prev[c];
    var v = d[k];
    if (k === 'idioma') return v === 'EN' ? 'EN' : 'ES';
    if (k === 'avisos' || k === 'publicada') return v === false || v === 'No' ? 'No' : 'Sí';
    if (k === 'foto') return /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+\/=]+$/.test(String(v)) && String(v).length < 49000 ? String(v) : '';
    return cgvSafe_(v);
  });
  t.sh.getRange(row, 1, 1, t.head.length).setNumberFormat('@').setValues([vals]);
  d._row = row;
  return d;
}
// "Imelda Gonzalez · Mission Property Management" → nombre y empresa
function cgvSplitKey_(k) {
  var parts = String(k || '').split(/\s+[·|\-–]\s+/);
  return { nombre: (parts[0] || '').trim(), empresa: parts.slice(1).join(' · ').trim() };
}
function cgvKey_(r) { return String(r.socio || '').trim() || (r.tipo === 'cliente' ? String(r.pagina || '').trim() : ''); }
// Mismo nombre si las palabras del más corto están en el otro (mínimo nombre y apellido)
function cgvSameName_(a, b) {
  var x = cgvNorm_(a).split(' ').filter(function (t) { return t.length > 1; });
  var y = cgvNorm_(b).split(' ').filter(function (t) { return t.length > 1; });
  if (x.length < 2 || y.length < 2) return false;
  var sh = x.length <= y.length ? x : y, lo = x.length <= y.length ? y : x;
  return sh.every(function (t) { return lo.indexOf(t) >= 0; });
}
function cgvPartners_() {
  if (typeof socRead_ !== 'function') return [];
  try {
    return socRead_('partners').map(function (p) {
      return { id: p.id, name: p.name, phone: p.phone, property: p.property, email: p.email || '', active: p.active !== 'no', rateType: p.rateType, flatRate: p.flatRate };
    });
  } catch (e) { return []; }
}
// Cada socio que ya refirió a alguien tiene su renglón en el Directorio (se liga solo con 🤝 Socios por nombre)
function cgvDirEnsure_(clientes, socios, partners) {
  var dir = cgvDirRead_(true), have = {};
  // Correos que se guardaron en el Directorio antes de que el perfil tuviera correo: se pasan al perfil una vez
  dir.forEach(function (d) {
    var p = d.socioId && partners.filter(function (x) { return x.id === d.socioId; })[0];
    if (p && !p.email && d.correo) { try { cgvSetPartnerEmail_(p.id, d.correo); p.email = d.correo; } catch (e) {} }
  });
  dir.forEach(function (d) { have[cgvNorm_(d.clave)] = d; });
  clientes.forEach(function (r) {
    var k = cgvKey_(r);
    if (!k || have[cgvNorm_(k)]) return;
    var s = cgvSplitKey_(k);
    var pr = partners.filter(function (p) { return cgvSameName_(p.name, s.nombre); })[0];
    var su = socios.filter(function (x) { return cgvSameName_(x.nombre, s.nombre) && x.correo; })[0];
    if (pr && !pr.email && su && su.correo) { try { cgvSetPartnerEmail_(pr.id, su.correo); pr.email = su.correo; } catch (e) {} }
    var d = cgvDirWrite_({ clave: k, socioId: pr ? pr.id : '', nombre: s.nombre, empresa: s.empresa || (pr && pr.property) || '',
      correo: pr ? '' : su ? su.correo : '', telefono: (pr && pr.phone) || (su && su.telefono) || '', idioma: 'ES', avisos: true, pagina: r.pagina || '' });
    have[cgvNorm_(k)] = d; dir.push(d);
  });
  return dir;
}
function cgvDirFor_(r, dir) {
  var k = cgvNorm_(cgvKey_(r));
  if (!k) return null;
  return (dir || cgvDirRead_()).filter(function (d) { return cgvNorm_(d.clave) === k; })[0] || null;
}

// ─── LISTA ─────────────────────────────────────────────────────────
function cgvList_() {
  var clientes = cgvRead_('cliente').concat(cgvRead_('familia'));
  var socios = cgvRead_('socio');
  var partners = cgvPartners_();
  cgvDirEnsure_(clientes, socios, partners);
  var dir = cgvDirRead_();
  var strip = function (o) { var c = {}; for (var k in o) if (k !== '_row') c[k] = o[k]; return c; };
  var dirOut = dir.map(function (d) { var c = strip(d); c.hasFoto = !!c.foto; delete c.foto; return c; });
  return {
    ok: true, clientes: clientes.map(strip), socios: socios.map(strip), dir: dirOut, partners: partners,
    socOn: typeof socSaveReferral_ === 'function', me: cgvMe_(), today: cgvToday_(), now: cgvNow_(),
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + CGV_SHEET_ID + '/edit'
  };
}

// ─── GUARDAR UNA SOLICITUD ─────────────────────────────────────────
// d: { tipo, id, estatus?, elegidos?, nota?, notas?, intento?, motivo?, avisar? }
function cgvSave_(d) {
  var tipo = String(d.tipo || ''), r = cgvFind_(tipo, d.id), me = cgvMe_(), now = cgvNow_();
  var lista = tipo === 'socio' ? CGV_ST_SOCIO : CGV_ST_CLIENTE;
  var ch = {}, log = r.historial.slice(), antes = r.estatus;
  var add = function (e) { e.f = now; e.por = me; log.push(e); };

  if (d.intento) {
    r.intentos += 1; ch['Intentos'] = r.intentos;
    add({ t: 'intento', x: cgvSafe_(d.intento === true ? 'No contestó' : d.intento, 120) });
  }
  if (d.elegidos !== undefined && tipo !== 'socio') {
    var el = cgvCleanServices_(d.elegidos), resA = cgvServicesText_(r.elegidos, 'ES'), resB = cgvServicesText_(el, 'ES');
    if (resA !== resB || JSON.stringify(el) !== JSON.stringify(r.elegidos)) {
      r.elegidos = el; ch['Servicios elegidos'] = el;
      if (resA !== resB) add({ t: 'servicios', x: resB || '(sin servicios)' });
    }
  }
  if (d.notas !== undefined) { r.notas = cgvSafe_(d.notas, 3000); ch['Notas'] = r.notas; }
  if (d.estatus && d.estatus !== r.estatus) {
    if (lista.indexOf(d.estatus) < 0) throw new Error('Estatus no válido: ' + d.estatus);
    if (d.estatus === 'Servicios elegidos' && !r.elegidos.length) throw new Error('Marca primero qué servicios eligió.');
    if (d.estatus === 'Instalado') {
      // Lo elegido queda instalado (con fecha de hoy si no tenía)
      r.elegidos = r.elegidos.map(function (s) { return { s: s.s, comp: s.comp, plan: s.plan, fecha: s.fecha || cgvToday_(), hecho: true }; });
      ch['Servicios elegidos'] = r.elegidos;
    }
    add({ t: 'estatus', de: r.estatus, a: d.estatus, x: d.motivo ? cgvSafe_(d.motivo, 300) : '' });
    r.estatus = d.estatus; ch['Estatus'] = r.estatus;
  }
  if (d.nota) add({ t: 'nota', x: cgvSafe_(d.nota, 1000) });
  if (!r.primerContacto && (d.intento || (r.estatus !== 'Nuevo' && antes === 'Nuevo'))) { r.primerContacto = now; ch['Primer contacto'] = now; }

  // Aviso al socio (solo clientes de socios, en los pasos que se avisan, si se pidió)
  var aviso = null, dir = null;
  if (tipo === 'cliente') dir = cgvDirFor_(r, null);
  if (d.avisar && tipo === 'cliente' && r.estatus !== antes && CGV_AVISO_ST[r.estatus]) {
    aviso = cgvSendAviso_(r, dir);
    if (aviso.sent) add({ t: 'aviso', x: 'Aviso por correo a ' + (dir.nombre || dir.clave) + ' (' + dir.correo + ')' });
  }
  // 🤝 Socios: lead al elegir internet, venta al quedar instalado
  var soc = null;
  if (tipo === 'cliente' && dir && dir.socioId) {
    try {
      soc = cgvSyncSocios_(r, dir);
      if (soc && soc.id && soc.id !== r.refId) { r.refId = soc.id; ch['Referido ID'] = soc.id; }
      if (soc && soc.id && dir.socioId !== r.socioId) { r.socioId = dir.socioId; ch['Socio ID'] = dir.socioId; }
      if (soc && soc.changed) add({ t: 'socios', x: soc.status === 'pending' ? 'Pasó a venta en 🤝 Socios' : 'Quedó como lead en 🤝 Socios' });
    } catch (e) { soc = { error: String(e && e.message || e) }; }
  }
  if (log.length > r.historial.length) { if (log.length > 150) log = log.slice(-150); r.historial = log; ch['Historial'] = log; }
  if (Object.keys(ch).length) {
    r.actualizado = now; r.atendio = me; ch['Actualizado'] = now; ch['Atendió'] = me;
    cgvWrite_(tipo, r._row, ch);
  }
  var item = {}; for (var k in r) if (k !== '_row') item[k] = r[k];
  item.ID = r.id; item.Nombre = r.nombre;   // para el Historial de cambios
  return { ok: true, item: item, aviso: aviso, socios: soc };
}

function cgvCleanServices_(v) {
  var a = cgvParseArr_(v), seen = {};
  return a.filter(function (s) { return s && CGV_SERVICIOS.indexOf(s.s) >= 0 && !seen[s.s] && (seen[s.s] = 1); }).map(function (s) {
    return { s: s.s, comp: cgvSafe_(s.comp, 60), plan: cgvSafe_(s.plan, 120), fecha: cgvYmd_(s.fecha || ''), hecho: !!s.hecho };
  });
}
var CGV_COMP_LABEL = { 'Tracfone': 'Tracfone 5G' };
function cgvServicesText_(arr, lang) {
  var EN = { 'Internet': 'Internet', 'Luz': 'Electricity', 'Celular': 'Mobile', 'TV': 'TV' };
  return (arr || []).map(function (s) {
    var n = lang === 'EN' ? EN[s.s] || s.s : s.s;
    var c = [CGV_COMP_LABEL[s.comp] || s.comp, s.plan].filter(String).join(' ');
    return n + (c ? ' (' + c + ')' : '');
  }).join(', ');
}

// ─── 🤝 SOCIOS: referido del socio ─────────────────────────────────
function cgvSyncSocios_(r, dir) {
  if (typeof socSaveReferral_ !== 'function' || typeof socRead_ !== 'function') return null;
  var CARR = typeof SOC_CARRIERS !== 'undefined' ? SOC_CARRIERS : ['Spectrum', 'AT&T', 'Viasat', 'Tracfone'];
  var net = r.elegidos.filter(function (s) { return s.s === 'Internet' && CARR.indexOf(s.comp) >= 0; })[0];
  if (!net) return null;
  var want = r.estatus === 'Instalado' || net.hecho ? 'pending' : (r.estatus === 'Servicios elegidos' ? 'lead' : '');
  if (!want) return null;
  if (!socRead_('partners').some(function (p) { return p.id === dir.socioId; })) return { error: 'El socio ligado ya no está en 🤝 Socios.' };
  var R = socRead_('referrals'), ph = cgvDigits_(r.telefono);
  var ref = r.refId ? R.filter(function (x) { return x.id === r.refId; })[0] : null;
  if (!ref) ref = R.filter(function (x) {
    return x.partnerId === dir.socioId && (x.status === 'lead' || x.status === 'pending') &&
      ((ph.length === 10 && cgvDigits_(x.phone) === ph) || cgvSameName_(x.name, r.nombre));
  })[0] || null;
  if (ref && (ref.status === 'paid' || ref.status === 'chargedback' || /^lost/.test(ref.status))) return { id: ref.id, status: ref.status, changed: false };
  if (ref && ref.status === 'pending') want = 'pending';   // nunca regresa de venta a lead
  var ventaFecha = '';
  r.historial.forEach(function (h) { if (!ventaFecha && h.t === 'estatus' && h.a === 'Servicios elegidos') ventaFecha = cgvYmd_(new Date(h.f)); });
  var d = {
    id: ref ? ref.id : '', name: r.nombre, phone: ref && ref.phone ? ref.phone : ph, address: ref && ref.address ? ref.address : r.direccion,
    partnerId: dir.socioId, carrier: ref && ref.carrier && ref.carrier !== 'Other' ? ref.carrier : net.comp,
    package: ref && ref.package ? ref.package : [net.comp, net.plan].filter(String).join(' '),
    saleDate: want === 'pending' ? (ref && ref.saleDate) || ventaFecha || cgvToday_() : '',
    installDate: want === 'pending' ? (ref && ref.installDate) || net.fecha || cgvToday_() : (ref && ref.installDate) || '',
    status: want, notes: ref && ref.notes ? ref.notes : 'ConnectRGV concierge · ' + r.id
  };
  if (ref && ref.commissionManual === 'yes') { d.commissionManual = 'yes'; d.commission = ref.commission; }
  var changed = !ref || ref.status !== want || (want === 'pending' && !ref.saleDate);
  if (!changed) return { id: ref.id, status: ref.status, changed: false };
  var id = socSaveReferral_(d);
  if (typeof socRecalc_ === 'function') socRecalc_();
  return { id: id, status: want, changed: true };
}

// ─── AVISO AL SOCIO ────────────────────────────────────────────────
function cgvSendAviso_(r, dir) {
  if (!dir) return { sent: false, reason: 'Este cliente no tiene socio.' };
  if (!dir.avisos) return { sent: false, reason: 'Los avisos de ' + (dir.nombre || dir.clave) + ' están apagados.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dir.correo || '')) return { sent: false, reason: 'Falta el correo de ' + (dir.nombre || dir.clave) + '.' };
  var m = cgvAvisoMsg_(r, dir);
  if (!m) return { sent: false, reason: 'Este paso no se avisa.' };
  MailApp.sendEmail({ to: dir.correo, subject: m.subject, body: m.text, htmlBody: m.html, name: 'ConnectRGV', replyTo: CGV_REPLY_TO });
  return { sent: true, to: dir.correo, nombre: dir.nombre };
}
// Vista previa (o texto para WhatsApp) del aviso que recibiría el socio con los cambios propuestos
function cgvAvisoGet_(d) {
  var r = cgvFind_(String(d.tipo || 'cliente'), d.id);
  if (d.estatus) r.estatus = d.estatus;
  if (d.elegidos !== undefined) r.elegidos = cgvCleanServices_(d.elegidos);
  if (r.estatus === 'Instalado') r.elegidos = r.elegidos.map(function (s) { s.hecho = true; s.fecha = s.fecha || cgvToday_(); return s; });
  var dir = cgvDirFor_(r, null), m = dir ? cgvAvisoMsg_(r, dir) : null;
  return { ok: true, can: !!m, to: dir ? dir.correo : '', nombre: dir ? dir.nombre : '', telefono: dir ? dir.telefono : '',
    avisos: dir ? dir.avisos : false, subject: m ? m.subject : '', text: m ? m.text : '', wa: m ? m.wa : '' };
}
function cgvFmtDate_(ymd, lang) {
  var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  var ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return lang === 'EN' ? EN[+m[2] - 1] + ' ' + (+m[3]) : (+m[3]) + ' de ' + ES[+m[2] - 1];
}
function cgvEsc_(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function cgvAvisoMsg_(r, dir) {
  if (!CGV_AVISO_ST[r.estatus]) return null;
  var EN = dir.idioma === 'EN', who = cgvFirst_(dir.nombre) || dir.nombre || '', cli = String(r.nombre || '').trim(), c1 = cgvFirst_(cli);
  var firma = cgvFirmaName_();
  var lines = r.elegidos.map(function (s) {
    var n = EN ? { 'Internet': 'Internet', 'Luz': 'Electricity', 'Celular': 'Mobile', 'TV': 'TV' }[s.s] : s.s;
    var c = [CGV_COMP_LABEL[s.comp] || s.comp, s.plan].filter(String).join(' ');
    var when = s.hecho ? (EN ? 'installed' : 'instalado') + (s.fecha ? ' ' + cgvFmtDate_(s.fecha, EN ? 'EN' : 'ES') : '')
      : s.fecha ? (EN ? 'install ' : 'instalación el ') + cgvFmtDate_(s.fecha, EN ? 'EN' : 'ES') : (EN ? 'install date pending' : 'falta fecha de instalación');
    return n + (c ? ' — ' + c : '') + ' · ' + when;
  });
  var subject, intro, outro;
  if (r.estatus === 'Contactado') {
    subject = EN ? 'ConnectRGV · I already spoke with ' + c1 : 'ConnectRGV · Ya hablé con ' + c1;
    intro = EN ? 'Just letting you know I already spoke with ' + cli + '. We are going over the services they need for the new home.'
      : 'Nada más para avisarle que ya hablé con ' + cli + '. Estamos viendo qué servicios necesita para su casa nueva.';
    outro = EN ? 'I will keep you posted.' : 'Le sigo avisando cómo va.';
  } else if (r.estatus === 'Servicios elegidos') {
    subject = EN ? 'ConnectRGV · ' + c1 + ' chose their services' : 'ConnectRGV · ' + c1 + ' ya eligió sus servicios';
    intro = EN ? cli + ' already chose their services:' : cli + ' ya eligió sus servicios:';
    outro = EN ? 'I will let you know once everything is installed.' : 'En cuanto quede todo instalado le aviso.';
  } else {
    subject = EN ? 'ConnectRGV · ' + c1 + ' is all set' : 'ConnectRGV · ' + c1 + ' ya quedó conectado';
    intro = EN ? cli + ' is all set. Their services are up and running:' : cli + ' ya tiene sus servicios funcionando:';
    outro = EN ? 'Thank you for trusting us with your clients.' : 'Gracias por confiarnos a sus clientes.';
  }
  var hola = EN ? 'Hi ' + who + ',' : 'Hola ' + who + ':';
  var closing = EN ? 'Anything you need, I am here.' : 'Cualquier cosa, aquí estoy.';
  var sig = [firma, EN ? 'ConnectRGV · Your home services concierge' : 'ConnectRGV · Tu concierge de servicios para el hogar', CGV_PHONE + ' · connectrgv.com'];
  var steps = EN ? ['Received', 'Contacted', 'Services chosen', 'Installed'] : ['Recibido', 'Contactado', 'Servicios elegidos', 'Instalado'];
  var cur = { 'Contactado': 1, 'Servicios elegidos': 2, 'Instalado': 3 }[r.estatus];
  var text = [hola, '', intro].concat(lines.length && r.estatus !== 'Contactado' ? lines.map(function (l) { return '• ' + l; }) : [])
    .concat(['', outro, '', closing, '', sig.join('\n')]).join('\n');
  var wa = [hola, intro].concat(lines.length && r.estatus !== 'Contactado' ? lines.map(function (l) { return '• ' + l; }) : []).concat([outro]).join('\n');
  var G = '#1E3A32', INK = '#111312', STONE = '#F4F2EE';
  var stepHtml = steps.map(function (s, i) {
    var on = i <= cur;
    return '<td style="text-align:center;padding:0 4px;width:25%">' +
      '<div style="width:22px;height:22px;line-height:22px;border-radius:11px;margin:0 auto 6px;font-size:12px;font-weight:700;' +
      (on ? 'background:' + G + ';color:#fff' : 'background:#E3E0D9;color:#8A877F') + '">' + (on ? '✓' : (i + 1)) + '</div>' +
      '<div style="font-size:12px;color:' + (on ? INK : '#8A877F') + ';' + (i === cur ? 'font-weight:700' : '') + '">' + s + '</div></td>';
  }).join('');
  var html = '<div style="background:' + STONE + ';padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:' + INK + '">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E3E0D9">' +
    '<div style="background:' + G + ';color:#fff;padding:16px 22px;font-size:18px;font-weight:700;letter-spacing:.3px">ConnectRGV</div>' +
    '<div style="padding:22px">' +
    '<p style="margin:0 0 14px;font-size:15px">' + cgvEsc_(hola) + '</p>' +
    '<p style="margin:0 0 14px;font-size:15px;line-height:1.5">' + cgvEsc_(intro) + '</p>' +
    (lines.length && r.estatus !== 'Contactado' ? '<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.6">' +
      lines.map(function (l) { return '<li>' + cgvEsc_(l) + '</li>'; }).join('') + '</ul>' : '') +
    '<table role="presentation" style="width:100%;border-collapse:collapse;margin:18px 0 18px"><tr>' + stepHtml + '</tr></table>' +
    '<p style="margin:0 0 14px;font-size:15px;line-height:1.5">' + cgvEsc_(outro) + '</p>' +
    '<p style="margin:0 0 18px;font-size:15px">' + cgvEsc_(closing) + '</p>' +
    '<p style="margin:0;font-size:13px;line-height:1.5;color:#55534E"><b style="color:' + INK + '">' + cgvEsc_(sig[0]) + '</b><br>' +
    cgvEsc_(sig[1]) + '<br>' + cgvEsc_(sig[2]) + '</p>' +
    '</div></div></div>';
  return { subject: subject, text: text, html: html, wa: wa };
}

// ─── DIRECTORIO: guardar ───────────────────────────────────────────
function cgvDirSave_(d) {
  var clave = String(d.clave || '').trim();
  if (!clave) throw new Error('Falta el nombre del socio.');
  var correo = String(d.correo || '').trim();
  if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error('Ese correo no se ve bien: ' + correo);
  var dir = cgvDirRead_(true), cur = dir.filter(function (x) { return cgvNorm_(x.clave) === cgvNorm_(d.claveOriginal || clave); })[0] || {};
  var o = {
    _row: cur._row, clave: clave, socioId: String(d.socioId || '').trim(), nombre: String(d.nombre || cur.nombre || cgvSplitKey_(clave).nombre).trim(),
    empresa: String(d.empresa !== undefined ? d.empresa : cur.empresa || '').trim(), correo: correo,
    telefono: cgvDigits_(d.telefono) || String(d.telefono || '').trim(), idioma: d.idioma === 'EN' ? 'EN' : 'ES',
    avisos: !(d.avisos === false || d.avisos === 'No' || d.avisos === 'false'), pagina: String(d.pagina !== undefined ? d.pagina : cur.pagina || '').trim()
  };
  // Ligado a 🤝 Socios: el correo se guarda en su perfil (una sola fuente)
  if (o.socioId) {
    if (!cgvPartners_().some(function (p) { return p.id === o.socioId; })) throw new Error('Ese socio ya no está en 🤝 Socios.');
    cgvSetPartnerEmail_(o.socioId, correo);
    o.correo = '';
  }
  cgvDirWrite_(o);
  delete o._row;
  o.Nombre = o.nombre;
  return { ok: true, item: o, dir: cgvDirRead_().map(function (x) { delete x._row; x.hasFoto = !!x.foto; delete x.foto; return x; }), partners: cgvPartners_() };
}

// ─── ALTA DE UN SOCIO QUE SE REGISTRÓ EN /socios/ ──────────────────
// d: { id, rateType?, flatRate?, pagina? }
function cgvPartnerCreate_(d) {
  if (typeof socSavePartner_ !== 'function') throw new Error('Falta Socios.gs en Apps Script.');
  var r = cgvFind_('socio', d.id), me = cgvMe_(), now = cgvNow_();
  var partners = cgvPartners_();
  var pr = partners.filter(function (p) { return cgvSameName_(p.name, r.nombre); })[0];
  var pid = pr ? pr.id : socSavePartner_({
    name: r.nombre, phone: cgvDigits_(r.telefono), property: r.empresa, payment: 'Zelle',
    rateType: d.rateType === 'flat' ? 'flat' : 'tiered', flatRate: d.flatRate || '',
    notes: ['ConnectRGV', r.tipoSocio, r.volumen ? r.volumen + ' mudanzas al mes' : ''].filter(String).join(' · ')
  });
  var clave = r.empresa ? r.nombre + ' · ' + r.empresa : r.nombre;
  var dir = cgvDirRead_(true), cur = dir.filter(function (x) { return cgvNorm_(x.clave) === cgvNorm_(clave) || x.socioId === pid; })[0];
  var mail = r.correo || (cur && cur.correo) || '';
  if (mail && !(pr && pr.email)) { try { cgvSetPartnerEmail_(pid, mail); } catch (e) {} }
  cgvDirWrite_({ _row: cur && cur._row, clave: cur ? cur.clave : clave, socioId: pid, nombre: r.nombre, empresa: r.empresa, correo: '',
    telefono: cgvDigits_(r.telefono) || (cur && cur.telefono) || '', idioma: cur ? cur.idioma : 'ES', avisos: cur ? cur.avisos : true,
    pagina: String(d.pagina || (cur && cur.pagina) || '').trim() });
  var log = r.historial.slice();
  log.push({ f: now, por: me, t: 'estatus', de: r.estatus, a: 'Dado de alta', x: pr ? 'Ya estaba en 🤝 Socios' : 'Alta en 🤝 Socios' });
  cgvWrite_('socio', r._row, { 'Estatus': 'Dado de alta', 'Socio ID': pid, 'Historial': log, 'Actualizado': now, 'Atendió': me,
    'Primer contacto': r.primerContacto || now });
  return { ok: true, partnerId: pid, existed: !!pr, item: { ID: r.id, Nombre: r.nombre }, clave: cur ? cur.clave : clave };
}

// ─── CORREO EN EL PERFIL DEL SOCIO (🤝 Socios → hoja Partners, columna "email") ───
// La columna se agrega sola al final de Partners (sin tocar Socios.gs).
function cgvSocEmailCol_() {
  try {
    if (typeof SOC_TABS !== 'undefined' && SOC_TABS.partners && SOC_TABS.partners.headers.indexOf('email') < 0) SOC_TABS.partners.headers.push('email');
  } catch (e) {}
}
function cgvSetPartnerEmail_(pid, email) {
  if (typeof socRead_ !== 'function' || typeof socSave_ !== 'function') throw new Error('Falta Socios.gs en Apps Script.');
  email = String(email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Ese correo no se ve bien: ' + email);
  cgvSocEmailCol_();
  var p = socRead_('partners').filter(function (x) { return x.id === String(pid); })[0];
  if (!p) throw new Error('No encontré ese socio.');
  if (String(p.email || '') === email) return p;
  p.email = email;
  socSave_('partners', p);
  return p;
}
// d: { partnerId, email } — desde el perfil del socio en 🤝 Socios
function cgvPartnerEmail_(d) {
  var p = cgvSetPartnerEmail_(d.partnerId, d.email);
  return { ok: true, partnerId: p.id, email: p.email || '', item: { ID: p.id, Nombre: p.name } };
}

// ─── PÁGINA DEL SOCIO EN CONNECTRGV.COM Y SU KIT ───────────────────
// La página connectrgv.com/<nombre> es una sola (socio/index.html) que le pide sus datos al Apps Script del sitio
// (ConnectRGV-formularios.gs → doGet), que los lee de la pestaña Directorio. Solo salen las que tienen Publicada = Sí.
function cgvSlug_(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^https?:\/\/[^\/]+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
// Busca el renglón del Directorio por clave o por socio de 🤝 Socios
function cgvDirFind_(d, dir) {
  dir = dir || cgvDirRead_();
  var byId = d.socioId ? dir.filter(function (x) { return x.socioId === String(d.socioId); })[0] : null;
  return byId || (d.clave ? dir.filter(function (x) { return cgvNorm_(x.clave) === cgvNorm_(d.clave); })[0] : null) || null;
}
function cgvPageGet_(d) {
  var dir = cgvDirRead_(), cur = cgvDirFind_(d, dir), pr = null;
  if (d.socioId) pr = cgvPartners_().filter(function (p) { return p.id === String(d.socioId); })[0] || null;
  if (!cur && !pr) throw new Error('No encontré ese socio.');
  var o = cur ? { clave: cur.clave, socioId: cur.socioId, nombre: cur.nombre, empresa: cur.empresa, correo: cur.correo, telefono: cur.telefono,
      idioma: cur.idioma, pagina: cgvSlug_(cur.pagina), foto: cur.foto, publicada: cur.publicada, existe: true }
    : { clave: '', socioId: pr.id, nombre: pr.name, empresa: pr.property || '', correo: pr.email || '', telefono: pr.phone || '', idioma: 'ES',
      pagina: cgvSlug_(pr.property || pr.name), foto: '', publicada: false, existe: false };
  if (pr && !o.correo) o.correo = pr.email || '';
  o.usadas = dir.filter(function (x) { return x !== cur && x.pagina; }).map(function (x) { return cgvSlug_(x.pagina); });
  o.reservadas = CGV_RESERVED;
  o.site = CGV_SITE;
  return { ok: true, page: o };
}
// d: { clave?, socioId?, pagina, nombre, empresa, foto? ('' quita, undefined no toca), publicada }
function cgvPageSave_(d) {
  var slug = cgvSlug_(d.pagina);
  if (slug.length < 3) throw new Error('La dirección de la página necesita al menos 3 letras.');
  if (CGV_RESERVED.indexOf(slug) >= 0) throw new Error('connectrgv.com/' + slug + ' ya la usa el sitio. Escoge otra.');
  var nombre = String(d.nombre || '').trim(), empresa = String(d.empresa || '').trim();
  if (!nombre) throw new Error('Falta el nombre del socio.');
  var dir = cgvDirRead_(true), cur = cgvDirFind_(d, dir), clave0 = empresa ? nombre + ' · ' + empresa : nombre;
  if (!cur) cur = dir.filter(function (x) { return cgvNorm_(x.clave) === cgvNorm_(clave0) && (!x.socioId || !d.socioId || x.socioId === String(d.socioId)); })[0] || null;
  var other = dir.filter(function (x) { return x !== cur && cgvSlug_(x.pagina) === slug; })[0];
  if (other) throw new Error('connectrgv.com/' + slug + ' ya es de ' + (other.nombre || other.clave) + '.');
  if (d.foto && !/^data:image\/(png|jpe?g|webp);base64,/.test(d.foto)) throw new Error('El logo tiene que ser imagen PNG, JPG o WebP.');
  if (d.foto && d.foto.length >= 49000) throw new Error('El logo quedó muy pesado. Prueba con otra imagen.');
  var o = cur ? { _row: cur._row } : { clave: clave0, socioId: String(d.socioId || ''), idioma: 'ES', avisos: true };
  if (cur && !cur.socioId && d.socioId) o.socioId = String(d.socioId);
  if (!cur && d.socioId) {
    var pr = cgvPartners_().filter(function (p) { return p.id === String(d.socioId); })[0];
    if (pr) o.telefono = cgvDigits_(pr.phone);
  }
  o.nombre = nombre; o.empresa = empresa; o.pagina = '/' + slug + '/';
  o.publicada = d.publicada !== false;
  if (d.foto !== undefined) o.foto = d.foto || '';
  cgvDirWrite_(o);
  var page = cgvPageGet_({ clave: cur ? cur.clave : o.clave, socioId: d.socioId }).page;
  return { ok: true, page: page, item: { ID: slug, Nombre: nombre } };
}
// Manda al socio su enlace y su QR (adjunto). d: { clave?, socioId?, qr: base64 PNG sin encabezado }
function cgvKitMail_(d) {
  var cur = cgvDirFind_(d, null);
  if (!cur || !cur.pagina) throw new Error('Primero guarda su página.');
  if (!cur.publicada) throw new Error('Su página está apagada. Actívala antes de mandarle el kit.');
  var to = String(cur.correo || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Falta el correo de ' + (cur.nombre || cur.clave) + ' (ponlo en su perfil de 🤝 Socios).');
  var slug = cgvSlug_(cur.pagina), url = 'https://' + CGV_SITE + '/' + slug, EN = cur.idioma === 'EN';
  var who = cgvFirst_(cur.nombre) || cur.nombre, firma = cgvFirmaName_();
  var subject = EN ? 'Your ConnectRGV page is ready' : 'Ya quedó lista su página de ConnectRGV';
  var paras = EN ? [
    'Hi ' + who + ',',
    'Your page is ready: ' + url,
    'Whenever you hand over a home, just share the link or the QR code (attached). Your clients fill in their info there, it reaches me tagged as yours, and I will keep you posted by email on how each one is doing.',
    'I will also bring you printed welcome cards you can leave at the house.',
    'Anything you need, I am here.'
  ] : [
    'Hola ' + who + ':',
    'Ya quedó lista su página: ' + url,
    'Cuando le entregue una casa a alguien, nada más compártale el enlace o el código QR (va adjunto). Sus clientes llenan sus datos ahí, a mí me llegan marcados como suyos y le voy avisando por correo cómo va cada uno.',
    'También le llevo unas tarjetas de bienvenida impresas para que las deje en la casa.',
    'Cualquier cosa, aquí estoy.'
  ];
  var sig = [firma, EN ? 'ConnectRGV · Your home services concierge' : 'ConnectRGV · Tu concierge de servicios para el hogar', CGV_PHONE + ' · ' + CGV_SITE];
  var text = paras.join('\n\n') + '\n\n' + sig.join('\n');
  var html = '<div style="background:#F4F2EE;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111312">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E3E0D9">' +
    '<div style="background:#1E3A32;color:#fff;padding:16px 22px;font-size:18px;font-weight:700">ConnectRGV</div><div style="padding:22px;font-size:15px;line-height:1.5">' +
    paras.map(function (t, i) {
      if (i === 1) return '<p style="margin:0 0 14px">' + cgvEsc_(t.replace(url, '')) + '<a href="' + url + '" style="color:#1E3A32;font-weight:700">' + CGV_SITE + '/' + slug + '</a></p>';
      return '<p style="margin:0 0 14px">' + cgvEsc_(t) + '</p>';
    }).join('') +
    '<p style="margin:18px 0 0;font-size:13px;color:#55534E"><b style="color:#111312">' + cgvEsc_(sig[0]) + '</b><br>' + cgvEsc_(sig[1]) + '<br>' + cgvEsc_(sig[2]) + '</p>' +
    '</div></div></div>';
  var opt = { to: to, subject: subject, body: text, htmlBody: html, name: 'ConnectRGV', replyTo: CGV_REPLY_TO };
  var qr = String(d.qr || '').replace(/^data:image\/png;base64,/, '');
  if (qr) {
    if (qr.length > 400000 || !/^[A-Za-z0-9+\/=]+$/.test(qr)) throw new Error('El QR no se pudo adjuntar.');
    opt.attachments = [Utilities.newBlob(Utilities.base64Decode(qr), 'image/png', 'QR-' + slug + '.png')];
  }
  MailApp.sendEmail(opt);
  return { ok: true, to: to, item: { ID: slug, Nombre: cur.nombre } };
}
