/**
 * ConnectRGV — recibe los formularios del sitio, los guarda en esta hoja y avisa por correo.
 * También le da a cada página de socio (connectrgv.com/<nombre>) los datos de su socio.
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
  var slug = String(p.p || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  var out = { ok: false };
  if (slug) {
    var cache = CacheService.getScriptCache(), hit = cache.get('pg_' + slug);
    if (hit) out = JSON.parse(hit);
    else {
      out = paginaSocio_(slug);
      try { cache.put('pg_' + slug, JSON.stringify(out), 120); } catch (x) { /* muy grande para el caché: no pasa nada */ }
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
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
