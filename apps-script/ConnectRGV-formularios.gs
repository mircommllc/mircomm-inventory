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

var AVISAR_A = 'connectrgv956@gmail.com';   // aquí llegan todos los avisos de ConnectRGV

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
    // Un aviso cada 6 h por socio. Escanear el QR de la hoja impresa avisa aparte (es señal de que la tiene en la mano).
    var qr = String(p.r || '') === 'QR';
    var cache = CacheService.getScriptCache(), clave = 'vis_' + (socio || nombre) + (qr ? '_qr' : '');
    if (!cache.get(clave)) {
      cache.put(clave, '1', 21600);
      try { avisoApertura_(socio, nombre, empresa, p.l === 'en', limpiar_(p.d), qr, hoja); }
      catch (x) {
        MailApp.sendEmail(AVISAR_A, 'ConnectRGV · ' + (nombre || socio) + ' abrió la presentación',
          (nombre || socio) + (empresa ? ' (' + empresa + ')' : '') + ' acaba de abrir la presentación del programa.' + (qr ? ' Llegó escaneando el QR.' : ''));
      }
    }
  }
  return ContentService.createTextOutput('ok');
}

// ─── CORREO "ABRIÓ LA PRESENTACIÓN" ─────────────────────────────────
// Con su teléfono (sale de la pestaña "Presentaciones", la llena el Hub al mandarla), botones de llamar y WhatsApp
// con un mensaje corto ya escrito, y aviso si llegó escaneando el QR de la hoja impresa.
function avisoApertura_(socio, nombre, empresa, en, dispositivo, qr, hojaVisitas) {
  var pr = presentacionDe_(socio, nombre);
  nombre = nombre || pr.nombre || socio; empresa = empresa || pr.empresa;
  var tel = pr.telefono, first = String(nombre).trim().split(/\s+/)[0] || nombre;
  var veces = vecesAbierta_(hojaVisitas, socio, nombre);
  var hora = Number(Utilities.formatDate(new Date(), 'America/Chicago', 'H'));
  var saludo = en ? (hora < 12 ? 'good morning' : hora < 18 ? 'good afternoon' : 'good evening')
    : (hora < 12 ? 'buenos días' : hora < 19 ? 'buenas tardes' : 'buenas noches');
  var wa = en
    ? 'Hi ' + first + ', ' + saludo + '. Just wanted to see if you had a chance to look at the ConnectRGV partner program. Any questions I can help with?'
    : 'Hola ' + first + ', ' + saludo + '. Nada más para saber si pudo ver la información del programa de socios de ConnectRGV. ¿No le quedó alguna duda? Con gusto se la aclaro.';
  var telFmt = tel ? '(' + tel.slice(0, 3) + ') ' + tel.slice(3, 6) + '-' + tel.slice(6) : '';
  var hTel = tel ? 'tel:+1' + tel : '', hWa = tel ? 'https://wa.me/1' + tel + '?text=' + encodeURIComponent(wa) : '';
  var enviada = pr.fecha ? hace_(pr.fecha) + (pr.via ? ' por ' + pr.via : '') + (pr.por ? ' (' + pr.por + ')' : '') : '';
  var vezTxt = veces > 1 ? 'Es la ' + veces + '.ª vez que la abre.' : 'Es la primera vez que la abre.';

  var asunto = 'ConnectRGV · ' + (qr ? '🔳 ' : '👀 ') + nombre + (qr ? ' escaneó el QR de la presentación' : ' abrió la presentación');
  var texto = [
    nombre + (empresa ? ' (' + empresa + ')' : '') + ' acaba de abrir la presentación del programa.',
    qr ? 'Llegó escaneando el QR de la hoja impresa: la tiene en la mano.' : null,
    vezTxt, '',
    tel ? 'Teléfono: ' + telFmt : 'No tengo su teléfono (ponlo la próxima vez que le mandes la presentación desde el Hub).',
    enviada ? 'Se la mandaste ' + enviada + '.' : '',
    'Idioma: ' + (en ? 'Inglés' : 'Español') + ' · ' + (dispositivo || ''),
    tel ? '' : null,
    tel ? 'Llamar: ' + hTel : null,
    tel ? 'WhatsApp: ' + hWa : null,
    '', 'Buen momento para darle seguimiento. Todo queda en la pestaña "Visitas programa" y en 📨 Presentaciones del Hub.'
  ].filter(function (l) { return l !== null && l !== undefined; }).join('\n').replace(/\n{3,}/g, '\n\n');

  var G = '#1E3A32', esc = function (v) { return String(v || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var btn = function (href, txt, bg) {
    return '<a href="' + esc(href) + '" style="display:inline-block;background:' + bg + ';color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 18px;border-radius:999px;margin:0 8px 8px 0">' + txt + '</a>';
  };
  var fila = function (k, v) { return v ? '<tr><td style="padding:4px 12px 4px 0;color:#55534E;white-space:nowrap;vertical-align:top">' + k + '</td><td style="padding:4px 0">' + v + '</td></tr>' : ''; };
  var html = '<div style="background:#F4F2EE;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111312">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E3E0D9">' +
    '<div style="background:' + G + ';color:#fff;padding:16px 22px;font-size:18px;font-weight:700">ConnectRGV</div><div style="padding:22px;font-size:15px;line-height:1.5">' +
    '<p style="margin:0 0 4px;font-size:19px;font-weight:700">' + esc(nombre) + (qr ? ' escaneó el QR' : ' abrió la presentación') + '</p>' +
    (empresa ? '<p style="margin:0 0 14px;color:#55534E">' + esc(empresa) + '</p>' : '<div style="height:10px"></div>') +
    (qr ? '<p style="margin:0 0 14px;padding:10px 14px;background:#FFF6DB;border-radius:8px;border:1px solid #F0DFA6">🔳 <b>Llegó escaneando el QR de la hoja impresa</b> — la tiene en la mano.</p>' : '') +
    '<table role="presentation" style="border-collapse:collapse;font-size:14px;margin:0 0 16px">' +
      fila('Teléfono', tel ? '<b>' + esc(telFmt) + '</b>' : '<span style="color:#9A6B00">No lo tengo — ponlo la próxima vez que le mandes la presentación desde el Hub.</span>') +
      fila('Se la mandaste', esc(enviada)) +
      fila('Veces', esc(vezTxt)) +
      fila('Idioma', esc((en ? 'Inglés' : 'Español') + (dispositivo ? ' · ' + dispositivo : ''))) +
    '</table>' +
    (tel ? '<p style="margin:0 0 6px">' + btn(hTel, '📞 Llamar', G) + btn(hWa, '💬 WhatsApp', '#1DA851') + '</p>' +
      '<p style="margin:0 0 16px;font-size:13px;color:#55534E">El WhatsApp ya va escrito: <i>' + esc(wa) + '</i></p>' : '') +
    '<p style="margin:0;font-size:13px;color:#55534E">Buen momento para darle seguimiento. Todo queda en la pestaña "Visitas programa" y en 📨 Presentaciones del Hub.</p>' +
    '</div></div></div>';
  MailApp.sendEmail({ to: AVISAR_A, subject: asunto, body: texto, htmlBody: html, name: 'ConnectRGV' });
}
// Último envío del prospecto en la pestaña "Presentaciones" (por clave; si no, por nombre)
function presentacionDe_(socio, nombre) {
  var out = { nombre: '', empresa: '', telefono: '', fecha: null, via: '', por: '' };
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Presentaciones');
  if (!hoja || hoja.getLastRow() < 2) return out;
  var v = hoja.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var c = function (n) { return h.indexOf(n); }, nn = norm_(nombre);
  for (var i = v.length - 1; i >= 1; i--) {
    var r = v[i], es = (socio && slug_(r[c('Clave')]) === socio) || (nn && norm_(r[c('Nombre')]) === nn);
    if (!es) continue;
    var tel = String(r[c('Teléfono')] || '').replace(/\D/g, '').slice(-10);
    if (!out.telefono && tel.length === 10) out.telefono = tel;
    if (!out.nombre) { out.nombre = String(r[c('Nombre')] || ''); out.empresa = String(r[c('Empresa')] || ''); }
    var via = String(r[c('Vía')] || '');
    if (!out.fecha && via !== 'Seguimiento' && r[c('Fecha')] instanceof Date) { out.fecha = r[c('Fecha')]; out.via = via; out.por = String(r[c('Por')] || ''); }
    if (out.telefono && out.fecha) break;
  }
  return out;
}
function vecesAbierta_(hoja, socio, nombre) {
  if (!hoja || hoja.getLastRow() < 2) return 1;
  var n = 0, nn = norm_(nombre);
  hoja.getRange(2, 2, hoja.getLastRow() - 1, 3).getValues().forEach(function (r) {
    if (r[0] === 'Abrió la presentación' && ((socio && String(r[1]) === socio) || (!socio && norm_(r[2]) === nn))) n++;
  });
  return Math.max(1, n);
}
function hace_(f) {
  var d = Math.floor((Date.now() - f.getTime()) / 864e5);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días';
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
