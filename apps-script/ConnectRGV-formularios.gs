/**
 * ConnectRGV — recibe los formularios del sitio, los guarda en esta hoja y avisa por correo.
 * También le da a cada página de socio (connectrgv.com/<nombre>) los datos de su socio,
 * cuenta las visitas y escaneos de esas páginas (pestaña "Visitas páginas")
 * y le da al panel privado de cada socio (connectrgv.com/<nombre>/panel) el avance de sus clientes.
 *
 * ACTUALIZAR (cuando ya está instalado):
 * 1. En la hoja "ConnectRGV -Solicitudes": Extensiones > Apps Script. Borra todo y pega este archivo. Guarda.
 * 2. Implementar > Administrar implementaciones > ✏️ (lápiz) > Versión: Nueva versión > Implementar.
 *    (NO "Nueva implementación": así la URL del sitio sigue siendo la misma.)
 */

var AVISAR_A = 'mircommllc@gmail.com';

var PESTANAS = {
  'familia': 'Familias',
  'cliente-de-socio': 'Clientes de socios',
  'socio': 'Socios'
};

var COLUMNAS = ['Recibido', 'Nombre', 'Teléfono', 'Correo', 'Empresa', 'Tipo de socio', 'Mudanzas al mes',
  'Socio que refirió', 'Fecha de mudanza', 'Dirección', 'Código postal', 'Cuándo se muda', 'Servicios', 'Página', 'Estatus'];

function doPost(e) {
  var j = cuerpoJson_(e);
  if (j && j.accion === 'panel') return panelSocio_(j);
  var p = (e && e.parameter) || {};
  var tipo = PESTANAS[p.tipo] ? p.tipo : 'familia';
  var hoja = obtenerHoja_(PESTANAS[tipo]);

  hoja.appendRow([
    new Date(),
    limpiar_(p.nombre), limpiar_(p.telefono), limpiar_(p.correo), limpiar_(p.empresa),
    limpiar_(p.tipo_socio || (tipo === 'socio' ? p.tipo : '')), limpiar_(p.volumen),
    limpiar_(p.socio), limpiar_(p.fecha), limpiar_(p.direccion), limpiar_(p.codigo_postal || p.zip),
    limpiar_(p.cuando), limpiar_(p.servicios), limpiar_(p.pagina), 'Nuevo'
  ]);

  var asunto = 'ConnectRGV · ' + PESTANAS[tipo] + ' · ' + (limpiar_(p.nombre) || 'sin nombre');
  var cuerpo = [
    'Nueva solicitud desde connectrgv.com (' + PESTANAS[tipo] + ')',
    '',
    'Nombre: ' + limpiar_(p.nombre),
    'Teléfono: ' + limpiar_(p.telefono),
    p.correo ? 'Correo: ' + limpiar_(p.correo) : '',
    p.empresa ? 'Empresa: ' + limpiar_(p.empresa) : '',
    p.socio ? 'Referido por: ' + limpiar_(p.socio) : '',
    p.cuando ? 'Se muda: ' + limpiar_(p.cuando) : '',
    p.fecha ? 'Fecha de mudanza: ' + limpiar_(p.fecha) : '',
    p.servicios ? 'Necesita: ' + limpiar_(p.servicios) : '',
    p.direccion ? 'Dirección: ' + limpiar_(p.direccion) : '',
    (p.codigo_postal || p.zip) ? 'Código postal: ' + limpiar_(p.codigo_postal || p.zip) : '',
    '',
    'Promesa: llamar el mismo día hábil.'
  ].filter(function (l) { return l !== ''; }).join('\n');
  MailApp.sendEmail(AVISAR_A, asunto, cuerpo);

  return ContentService.createTextOutput('ok');
}

// Páginas de socios: connectrgv.com/<nombre> pide aquí los datos de su socio.
// Solo salen los socios con "Publicada = Sí" en la pestaña Directorio (la llena el Hub, en 🧰 Página y kit).
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.ev === 'pagina') return registrarPagina_(p);
  if (p.ev) return registrarVisita_(p);
  var slug = slug_(p.p);
  return json_(slug ? paginaSocioCache_(slug) : { ok: false });
}
function paginaSocioCache_(slug) {
  var cache = CacheService.getScriptCache(), hit = cache.get('pg_' + slug);
  if (hit) return JSON.parse(hit);
  var out = paginaSocio_(slug);
  try { cache.put('pg_' + slug, JSON.stringify(out), 120); } catch (x) { /* muy grande para el caché: no pasa nada */ }
  return out;
}
function paginaSocio_(slug) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Directorio');
  if (!hoja || hoja.getLastRow() < 2) return { ok: false };
  var v = hoja.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var c = function (n) { return h.indexOf(n); };
  for (var i = 1; i < v.length; i++) {
    var pag = String(v[i][c('Pagina')] || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (pag !== slug) continue;
    if (String(v[i][c('Publicada')] || '') !== 'Sí') return { ok: false };
    return {
      ok: true, slug: slug, clave: String(v[i][c('Clave')] || ''), nombre: String(v[i][c('Nombre')] || ''),
      empresa: String(v[i][c('Empresa')] || ''), foto: c('Foto') >= 0 ? String(v[i][c('Foto')] || '') : '',
      idioma: String(v[i][c('Idioma')] || 'ES')
    };
  }
  return { ok: false };
}

// Presentación para socios (connectrgv.com/programa): quién la abrió y qué hizo.
// El link personalizado lleva ?n=Nombre&e=Empresa&s=clave. Avisa por correo cuando un socio la abre
// (una vez cada 6 horas por socio, para no llenarte el correo).
var EVENTOS_VISITA = {
  'abrio': 'Abrió la presentación', 'final': 'Llegó al registro', 'llamar': 'Tocó Llamar',
  'texto': 'Tocó Mandar mensaje', 'guia': 'Abrió la guía', 'registro': 'Se registró'
};
var COLUMNAS_VISITA = ['Fecha', 'Evento', 'Socio', 'Nombre', 'Empresa', 'Idioma', 'Dispositivo', 'Viene de'];

function registrarVisita_(p) {
  var ev = String(p.ev || '');
  if (!EVENTOS_VISITA[ev]) return ContentService.createTextOutput('ok');
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName('Visitas programa');
  if (!hoja) {
    hoja = libro.insertSheet('Visitas programa');
    hoja.appendRow(COLUMNAS_VISITA);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, COLUMNAS_VISITA.length).setFontWeight('bold');
  }
  var socio = limpiar_(p.s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  var nombre = limpiar_(p.n).slice(0, 80), empresa = limpiar_(p.e).slice(0, 80);
  var idioma = p.l === 'en' ? 'Inglés' : 'Español';
  hoja.appendRow([new Date(), EVENTOS_VISITA[ev], socio, nombre, empresa, idioma, limpiar_(p.d).slice(0, 20), limpiar_(p.r).slice(0, 80)]);

  if (ev === 'abrio' && (socio || nombre)) {
    var cache = CacheService.getScriptCache(), clave = 'vis_' + (socio || nombre);
    if (!cache.get(clave)) {
      cache.put(clave, '1', 21600);
      MailApp.sendEmail(AVISAR_A,
        'ConnectRGV · ' + (nombre || socio) + ' abrió la presentación',
        [(nombre || socio) + (empresa ? ' (' + empresa + ')' : '') + ' acaba de abrir la presentación del programa.',
         '', 'Idioma: ' + idioma, 'Dispositivo: ' + limpiar_(p.d),
         '', 'Buen momento para darle seguimiento. Todo queda en la pestaña "Visitas programa".'].join('\n'));
    }
  }
  return ContentService.createTextOutput('ok');
}

// ─── VISITAS A LAS PÁGINAS DE SOCIO ─────────────────────────────────
// connectrgv.com/<nombre> avisa aquí cada vez que alguien la abre (una vez por visita, no por recarga).
// Llegó por: "QR" (el QR del kit trae ?qr), "Enlace" (le compartieron el link: WhatsApp, correo, Facebook…) o "Directo".
var COLUMNAS_PAGINA = ['Fecha', 'Página', 'Socio', 'Llegó por', 'Idioma', 'Dispositivo', 'Viene de'];
var VIA_PAGINA = { qr: 'QR', enlace: 'Enlace', directo: 'Directo' };

function registrarPagina_(p) {
  var slug = slug_(p.s);
  var info = slug ? paginaSocioCache_(slug) : null;
  if (!info || !info.ok) return ContentService.createTextOutput('ok');   // solo páginas publicadas
  var libro = SpreadsheetApp.getActiveSpreadsheet(), hoja = libro.getSheetByName('Visitas páginas');
  if (!hoja) {
    hoja = libro.insertSheet('Visitas páginas');
    hoja.appendRow(COLUMNAS_PAGINA);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, COLUMNAS_PAGINA.length).setFontWeight('bold');
  }
  hoja.appendRow([new Date(), slug, info.clave || info.nombre || '', VIA_PAGINA[p.v] || 'Directo',
    p.l === 'en' ? 'Inglés' : 'Español', limpiar_(p.d).slice(0, 20), limpiar_(p.r).slice(0, 80)]);
  return ContentService.createTextOutput('ok');
}

// ─── PANEL PRIVADO DEL SOCIO ────────────────────────────────────────
// connectrgv.com/<nombre>/panel manda { accion: 'panel', p: <nombre>, k: <clave> } y recibe el avance de sus clientes.
// La clave vive en la pestaña Directorio (columna "Clave panel"); la saca el Hub en 🧰 Página y kit.
// Solo sale lo que el socio necesita: nombre corto, fechas, en qué paso va y qué servicios eligió. Nada de teléfonos,
// direcciones, planes ni comisiones. Después de 8 claves equivocadas, esa página se bloquea 15 minutos.
var PANEL_INTENTOS = 8, PANEL_BLOQUEO = 900;
var PANEL_PASOS = { 'Nuevo': 1, 'Contactado': 2, 'Servicios elegidos': 3, 'Instalado': 4, 'No avanzó': 0 };

function panelSocio_(j) {
  var slug = slug_(j.p), clave = String(j.k || '').replace(/\D/g, '').slice(0, 8);
  if (!slug) return json_({ ok: false, code: 'PAGINA' });
  var cache = CacheService.getScriptCache(), fk = 'pf_' + slug, fallas = Number(cache.get(fk) || 0);
  if (fallas >= PANEL_INTENTOS) return json_({ ok: false, code: 'BLOQUEO' });
  var d = directorioPorPagina_(slug);
  if (!d || !d.pin || clave.length < 4 || clave !== d.pin) {
    cache.put(fk, String(fallas + 1), PANEL_BLOQUEO);
    return json_({ ok: false, code: d && d.pin ? 'CLAVE' : 'SIN_PANEL', quedan: Math.max(0, PANEL_INTENTOS - fallas - 1) });
  }
  cache.remove(fk);
  var tz = Session.getScriptTimeZone();
  var ymd = function (v) {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    var s = String(v || '').trim(), m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return '';
  };
  var libro = SpreadsheetApp.getActiveSpreadsheet(), clientes = [];
  var hoja = libro.getSheetByName('Clientes de socios');
  if (hoja && hoja.getLastRow() > 1) {
    var v = hoja.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
    var c = function (n) { return h.indexOf(n); }, claveN = norm_(d.clave);
    for (var i = 1; i < v.length; i++) {
      var r = v[i], socio = c('Socio que refirió') >= 0 ? r[c('Socio que refirió')] : '', pag = c('Página') >= 0 ? r[c('Página')] : '';
      var es = (claveN && norm_(socio) === claveN) || slugDeRuta_(pag) === slug;
      if (!es || !String(r[c('Nombre')] || '').trim()) continue;
      var estatus = String((c('Estatus') >= 0 && r[c('Estatus')]) || 'Nuevo').trim();
      if (!(estatus in PANEL_PASOS)) estatus = 'Nuevo';
      var elegidos = [];
      try { elegidos = c('Servicios elegidos') >= 0 ? JSON.parse(String(r[c('Servicios elegidos')] || '[]')) : []; } catch (x) { elegidos = []; }
      if (!Array.isArray(elegidos)) elegidos = [];
      clientes.push({
        n: nombreCorto_(r[c('Nombre')]), recibido: ymd(r[c('Recibido')]), mudanza: c('Fecha de mudanza') >= 0 ? ymd(r[c('Fecha de mudanza')]) : '',
        estatus: estatus, paso: PANEL_PASOS[estatus],
        elegidos: elegidos.filter(function (s) { return s && s.s; }).map(function (s) {
          return { s: String(s.s), comp: String(s.comp || '').slice(0, 40), hecho: !!s.hecho || estatus === 'Instalado' };
        }),
        pidio: c('Servicios') >= 0 ? String(r[c('Servicios')] || '').slice(0, 120) : '',
        actualizado: c('Actualizado') >= 0 ? ymd(r[c('Actualizado')]) : ''
      });
    }
  }
  clientes.sort(function (a, b) { return (b.recibido || '').localeCompare(a.recibido || ''); });
  // Visitas a su página
  var vis = { total: 0, mes: 0, qr: 0 }, hv = libro.getSheetByName('Visitas páginas');
  if (hv && hv.getLastRow() > 1) {
    var desde = new Date(Date.now() - 30 * 864e5);
    hv.getRange(2, 1, hv.getLastRow() - 1, 4).getValues().forEach(function (r) {
      if (String(r[1]) !== slug) return;
      vis.total++;
      if (r[0] instanceof Date && r[0] >= desde) vis.mes++;
      if (r[3] === 'QR') vis.qr++;
    });
  }
  return json_({ ok: true, slug: slug, nombre: d.nombre, empresa: d.empresa, idioma: d.idioma, clientes: clientes, visitas: vis,
    hoy: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') });
}
function directorioPorPagina_(slug) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Directorio');
  if (!hoja || hoja.getLastRow() < 2) return null;
  var v = hoja.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var c = function (n) { return h.indexOf(n); };
  if (c('Pagina') < 0) return null;
  for (var i = 1; i < v.length; i++) {
    if (slugDeRuta_(v[i][c('Pagina')]) !== slug) continue;
    return {
      clave: String(v[i][c('Clave')] || ''), nombre: String(v[i][c('Nombre')] || ''), empresa: String(v[i][c('Empresa')] || ''),
      idioma: String((c('Idioma') >= 0 && v[i][c('Idioma')]) || 'ES'), pin: c('Clave panel') >= 0 ? String(v[i][c('Clave panel')] || '').replace(/\D/g, '') : ''
    };
  }
  return null;
}
// "/missionpm/" → "missionpm"
function slugDeRuta_(v) {
  var parts = String(v || '').toLowerCase().replace(/^https?:\/\/[^\/]+/, '').split(/[\/?#]/).filter(String);
  return slug_(parts[0] === 'socio' ? '' : parts[0]);
}
// "María Guadalupe Treviño" → "María T."
function nombreCorto_(n) {
  var w = String(n || '').trim().split(/\s+/);
  return w.length > 1 ? w[0] + ' ' + w[w.length - 1].charAt(0).toUpperCase() + '.' : w[0];
}
function norm_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function slug_(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function cuerpoJson_(e) {
  if (!e || !e.postData || !/^text\/plain/.test(String(e.postData.type || ''))) return null;
  try { return JSON.parse(e.postData.contents); } catch (x) { return null; }
}

function obtenerHoja_(nombre) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(nombre);
  if (!hoja) {
    hoja = libro.insertSheet(nombre);
    hoja.appendRow(COLUMNAS);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, COLUMNAS.length).setFontWeight('bold');
  }
  return hoja;
}

function limpiar_(v) {
  v = String(v || '').trim().slice(0, 500);
  // Evita que un texto empiece como fórmula en la hoja
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
