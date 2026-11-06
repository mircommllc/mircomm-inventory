/**
 * Disputas.gs — llena el formato oficial de disputas de Cellmart (COMMISSION DISPUTE FORM .xlsm)
 * -----------------------------------------------------------------------------
 * Cellmart pide que TODA disputa de comisión vaya en su archivo de Excel. El Hub:
 *  1. Toma el formato más nuevo que Cellmart te mandó por correo (busca en tu Gmail el .xlsm "DISPUTE FORM").
 *  2. Llena una fila por cuenta con los datos de Activaciones + Core Report + Commission Reports
 *     (fecha de activación, cuenta, work order, PSU, bundle, líneas, cliente, dirección, motivo y cuánto
 *     esperabas vs. cuánto te pagaron) y arriba el agente, su SAID, el mercado y la fecha.
 *  3. Lo adjunta al correo a commissions@cellmart.us (escSend_ en Escritorio.gs).
 * Solo escribe en las celdas; el archivo sigue siendo el mismo de Cellmart (con su macro y sus listas).
 *
 * Usa: escRowsOf_, escReport_, escUnpaidInternet_, escDigits_, escMdy_ (Escritorio.gs), actRepMap_ (Activaciones.gs).
 * INSTALAR: Apps Script → ＋ → Script → "Disputas" → pega todo → Guardar → Deploy → New version.
 */

var DISP_MARKET = 'South Texas';
// Nombre completo del agente para cada persona (el formato pide AGENT NAME + AGENT SAID)
var DISP_FULL_NAMES = { Joel: 'Joel Chavez', Lizbeth: 'Lizbeth Baltazar', Alondra: 'Alondra Soria' };
var DISP_DEFAULT_SAID = 'CMMCL4423';
var DISP_MAX_ROWS = 23;   // filas del formato (12 a 34)
var DISP_REASONS = ['Expected payment not received', 'Incorrect payouts'];
var DISP_COLS = ['activacion', 'cuenta', 'workOrder', 'psu', 'bundle', 'lineas', 'cliente', 'direccion', 'estado', 'zip', 'correo', 'motivo', 'info'];

// ─── Formato de Cellmart (de tu Gmail) ─────────────────────────────
function dispTemplate_() {
  var cache = CacheService.getScriptCache();
  try {
    var c = cache.get('disp_tpl');
    if (c) { var j = JSON.parse(c); return { blob: Utilities.newBlob(Utilities.base64Decode(j.b), j.t, j.n), name: j.n, fecha: j.f }; }
  } catch (e) {}
  var best = null;
  GmailApp.search('from:cellmart.us filename:xlsm dispute', 0, 20).forEach(function (th) {
    th.getMessages().forEach(function (m) {
      m.getAttachments().forEach(function (at) {
        var n = String(at.getName() || '');
        if (/dispute/i.test(n) && /\.xlsm$/i.test(n) && (!best || m.getDate() > best.d)) best = { a: at, d: m.getDate(), n: n };
      });
    });
  });
  if (!best) throw new Error('No encontré el formato de disputa de Cellmart (COMMISSION DISPUTE FORM .xlsm) en tu Gmail.');
  var blob = best.a.copyBlob();
  var f = Utilities.formatDate(best.d, Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd');
  try { cache.put('disp_tpl', JSON.stringify({ b: Utilities.base64Encode(blob.getBytes()), t: blob.getContentType(), n: best.n, f: f }), 21600); } catch (e) {}
  return { blob: blob, name: best.n, fecha: f };
}

// ─── Datos de cada cuenta ──────────────────────────────────────────
function dispTitle_(s) { return String(s || '').toLowerCase().replace(/(^|[\s'-])\S/g, function (c) { return c.toUpperCase(); }).trim(); }
function dispName_(full) {
  var p = String(full || '').replace(/‌/g, '').split(',');
  return dispTitle_(p.length > 1 ? p.slice(1).join(' ') + ' ' + p[0] : p[0]);
}
function dispMdy_(ymd) { var p = String(ymd || '').split('-'); return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : ''; }
function dispValidDate_(mdy) { var y = escMdy_(mdy); return y && y > '2000-01-01' ? y : ''; }
function dispMoney_(v) { var n = Number(String(v === undefined || v === null ? '' : v).replace(/[$,\s]/g, '')); return isNaN(n) ? 0 : n; }
function dispPsuOf_(k) { var p = String(k.PSU || ''); return /video|tv/i.test(p) ? 'TV' : /voice|phone/i.test(p) ? 'Voice' : /mobile/i.test(p) ? 'Mobile' : /internet/i.test(p) ? 'Internet' : ''; }

/**
 * cuentas: ['8260…', …]   hints: { '8260…': { psu, esperado, pagado, motivo, info } } (opcional, del Hub)
 * Regresa { rows: [...], faltan: n } con una fila por cuenta, lista para revisar en el Hub.
 */
function dispRows_(cuentas, hints) {
  hints = hints || {};
  var acts = escRowsOf_('Activations');
  var core = [], com = [], unpaid = {}, ultimoPago = '';
  try { core = escReport_('core').rows; } catch (e) {}
  try { com = escReport_('commission').rows; } catch (e) {}
  try { var u = escUnpaidInternet_(); ultimoPago = u.ultimoPagoYmd || ''; u.list.forEach(function (x) { unpaid[x.cuenta] = x; }); } catch (e) {}
  var repMap = {};
  try { repMap = actRepMap_(); } catch (e) {}
  var seen = {}, rows = [];
  (cuentas || []).forEach(function (c0) {
    var acct = escDigits_(c0);
    if (acct.length < 10 || seen[acct]) return;
    seen[acct] = 1;
    var h = hints[acct] || hints[c0] || {};
    var mine = acts.filter(function (a) { return escDigits_(a.AccountNumber) === acct; })
      .sort(function (a, b) { return String(b.OrderDate).localeCompare(String(a.OrderDate)); });
    var ks = core.filter(function (k) { return escDigits_(k['Customer - Account Number']) === acct; });
    var cs = com.filter(function (c) { return escDigits_(c['Account No.']) === acct; });
    var u = unpaid[acct];
    var psu = h.psu || (u ? 'Internet' : '');
    var a = (psu === 'Internet' && mine.filter(function (x) { return x.InternetTier; })[0]) ||
      (psu === 'Mobile' && mine.filter(function (x) { return Number(x.MobileLines) > 0; })[0]) || mine[0] || {};
    if (!psu) psu = a.InternetTier ? 'Internet' : Number(a.MobileLines) > 0 ? 'Mobile' : a.VideoTier ? 'TV' : ks.length ? dispPsuOf_(ks[0]) : 'Internet';
    var kp = ks.filter(function (k) { return dispPsuOf_(k) === psu && String(k['Sales - Connects']) === '1'; })[0] ||
      ks.filter(function (k) { return dispPsuOf_(k) === psu; })[0] || ks[0] || {};
    var conn = (u && u.conecto) || dispValidDate_(kp['Date - Connect']) || String(a.OrderDate || '').slice(0, 10);
    // bundle: servicios residenciales (Internet / TV / Voice) del mismo work order
    var wo = escDigits_(kp['Work Order Number']) || escDigits_(a.WorkOrder);
    var res = {};
    ks.forEach(function (k) { var p = dispPsuOf_(k); if (p && p !== 'Mobile' && (!wo || escDigits_(k['Work Order Number']) === wo)) res[p] = 1; });
    if (a.InternetTier) res.Internet = 1; if (a.VideoTier) res.TV = 1; if (a.Voice && !/^(no|0|n\/a)$/i.test(String(a.Voice))) res.Voice = 1;
    var nres = Object.keys(res).length;
    var bundle = nres >= 3 ? 'Triple Play' : nres === 2 ? 'Double Play' : 'Single Play';
    // lo que Cellmart ya pagó para este servicio
    var pagado = 0, ultimoPagoCuenta = '';
    cs.forEach(function (c) {
      var isPsu = psu === 'Internet' ? Number(c['Internet PSU']) > 0 || /internet/i.test(c['Bundle Name'])
        : psu === 'Mobile' ? Number(c['Mobile PSU']) > 0 || /mobile/i.test(c['Bundle Name'])
        : psu === 'TV' ? Number(c['Video PSU']) > 0 || /video/i.test(c['Bundle Name']) : Number(c['Voice PSU']) > 0;
      if (!isPsu) return;
      pagado += dispMoney_(c['Commission Paid']) * (String(c.Direction || 'Add') === 'Remove' ? -1 : 1);
      var pd = escMdy_(c['Payment Date']); if (pd > ultimoPagoCuenta) ultimoPagoCuenta = pd;
    });
    if (h.pagado !== undefined && h.pagado !== '') pagado = dispMoney_(h.pagado);
    var esperado = h.esperado !== undefined && h.esperado !== '' ? dispMoney_(h.esperado) : (u && u.monto) || '';
    var tier = (u && u.tier) || kp['InternetTier - Time of Connect'] || a.InternetTier || '';
    var motivo = h.motivo && DISP_REASONS.indexOf(h.motivo) >= 0 ? h.motivo : (pagado > 0 ? 'Incorrect payouts' : 'Expected payment not received');
    var exp = esperado !== '' ? 'Expected $' + esperado + (psu === 'Internet' && tier ? ' (Internet ' + tier + ')' : psu === 'Mobile' ? ' (mobile line)' : '') + ', received $' + pagado
      : 'Received $' + pagado;
    var info = h.info || [
      exp + (pagado && ultimoPagoCuenta ? ' on ' + dispMdy_(ultimoPagoCuenta) : ''),
      conn ? 'Connected ' + dispMdy_(conn) : '',
      !pagado && ultimoPago ? 'Not on any Commission Report through ' + dispMdy_(ultimoPago) : ''
    ].filter(String).join('. ') + '.';
    var addr1 = [kp['SVC Unit - Address Line 1'], kp['SVC Unit - Address Line 2']].filter(function (x) { return x && x !== 'N/A'; }).join(' ');
    var city = kp['SVC Unit - City'] || a.City || '';
    var direccion = addr1 ? dispTitle_(addr1) + (city ? ', ' + dispTitle_(city) : '') : [a.Address, a.City].filter(String).join(', ');
    var rep = String(kp.Agent || a.RepID || (u && u.rep) || DISP_DEFAULT_SAID).toUpperCase();
    var row = {
      activacion: conn, cuenta: acct, workOrder: wo, psu: psu, bundle: bundle,
      lineas: Number(a.MobileLines) || 0,
      cliente: kp['Customer Full Name'] ? dispName_(kp['Customer Full Name']) : (a.CustomerName || (cs[0] ? dispName_(cs[0]['Customer Name']) : '')),
      direccion: direccion, estado: String(kp['SVC Unit - State'] || a.State || (cs[0] && cs[0].State) || 'TX'),
      zip: String(kp['SVC Unit - Zip Code'] || a.Zip || (cs[0] && cs[0].Zip) || ''),
      correo: String(a.Email || (cs.filter(function (c) { return c.Email; })[0] || {}).Email || ''),
      motivo: motivo, info: info, rep: rep,
      agente: repMap[rep] || '', esperado: esperado, pagado: pagado
    };
    row.faltan = ['activacion', 'workOrder', 'cliente', 'direccion', 'zip', 'correo'].filter(function (f) { return !row[f]; });
    rows.push(row);
  });
  return { ok: true, rows: rows, mercado: DISP_MARKET, fecha: escToday_() };
}

// ─── Armar el .xlsm ────────────────────────────────────────────────
/** rows: filas (ya revisadas en el Hub). Regresa un archivo por agente (SAID): [{ blob, name, said, n }] */
function dispFiles_(rows, fecha) {
  rows = (rows || []).filter(function (r) { return r && escDigits_(r.cuenta).length >= 10; });
  if (!rows.length) throw new Error('No hay cuentas para el formato de disputa.');
  var tpl = dispTemplate_();
  var groups = {}, order = [];
  rows.forEach(function (r) { var k = String(r.rep || DISP_DEFAULT_SAID).toUpperCase(); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(r); });
  var repMap = {}; try { repMap = actRepMap_(); } catch (e) {}
  var out = [];
  order.forEach(function (said) {
    var list = groups[said];
    for (var i = 0; i < list.length; i += DISP_MAX_ROWS) {
      var part = list.slice(i, i + DISP_MAX_ROWS);
      var first = repMap[said] || part[0].agente || 'Joel';
      var meta = { agente: DISP_FULL_NAMES[first] || first, said: said, mercado: DISP_MARKET, fecha: fecha || escToday_() };
      var name = 'COMMISSION DISPUTE FORM - MirComm - ' + said + ' - ' + dispMdy_(meta.fecha).replace(/\//g, '-') +
        (list.length > DISP_MAX_ROWS ? ' (' + (i / DISP_MAX_ROWS + 1) + ')' : '') + '.xlsm';
      out.push({ blob: dispBuild_(tpl.blob, meta, part, name), name: name, said: said, n: part.length });
    }
  });
  return out;
}

function dispBuild_(tplBlob, meta, rows, name) {
  var src = tplBlob.copyBlob();
  src.setContentType('application/zip');
  var files = Utilities.unzip(src);
  var byName = {};
  files.forEach(function (f) { byName[f.getName()] = f; });
  var sheetPath = dispFirstSheet_(byName);
  var sst = byName['xl/sharedStrings.xml'] ? byName['xl/sharedStrings.xml'].getDataAsString('UTF-8') : '';
  var xml = byName[sheetPath].getDataAsString('UTF-8');
  var filled = dispFillSheet_(xml, sst, meta, rows);
  var out = files.map(function (f) { return f.getName() === sheetPath ? Utilities.newBlob(filled, 'application/xml', sheetPath) : f; });
  var zip = Utilities.zip(out, name);
  zip.setContentType('application/vnd.ms-excel.sheet.macroEnabled.12');
  zip.setName(name);
  return zip;
}
function dispFirstSheet_(byName) {
  try {
    var wb = byName['xl/workbook.xml'].getDataAsString('UTF-8');
    var rid = (wb.match(/<sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
    var rels = byName['xl/_rels/workbook.xml.rels'].getDataAsString('UTF-8');
    var re = new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*>'), m = rels.match(re);
    var t = m && (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (t) { t = t.replace(/^\//, ''); if (t.indexOf('xl/') !== 0) t = 'xl/' + t; if (byName[t]) return t; }
  } catch (e) {}
  if (byName['xl/worksheets/sheet1.xml']) return 'xl/worksheets/sheet1.xml';
  throw new Error('El formato de disputa no tiene la hoja esperada.');
}

// ─── Escribir en el XML de la hoja (sin tocar estilos, listas ni macro) ──
function dispXmlText_(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function dispEsc_(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F‌]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function dispColNum_(col) { var n = 0; for (var i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64); return n; }
function dispColName_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function dispSerial_(ymd) {
  var p = String(ymd || '').split('-').map(Number);
  if (p.length !== 3 || !p[0]) return null;
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
}

function dispFillSheet_(xml, sstXml, meta, rows) {
  var sst = [];
  String(sstXml || '').replace(/<si>([\s\S]*?)<\/si>/g, function (m, inner) {
    var t = ''; inner.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (mm, x) { t += x; return mm; });
    sst.push(dispXmlText_(t)); return m;
  });
  // texto de cada celda
  var text = {};
  xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (m, col, row, attrs, inner) {
    var v = '';
    if (/t="s"/.test(attrs)) { var i = (String(inner || '').match(/<v>(\d+)<\/v>/) || [])[1]; v = i !== undefined ? sst[Number(i)] || '' : ''; }
    else if (/t="inlineStr"/.test(attrs)) { String(inner || '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (mm, x) { v += dispXmlText_(x); return mm; }); }
    text[col + row] = String(v).replace(/\s+/g, ' ').trim().toUpperCase();
    return m;
  });
  var find = function (label) {
    for (var k in text) if (text[k].indexOf(label) === 0) { var mm = k.match(/^([A-Z]+)(\d+)$/); return { col: mm[1], row: Number(mm[2]) }; }
    return null;
  };
  var set = function (col, row, val, kind) { xml = dispSetCell_(xml, col, row, val, kind); };
  // encabezado de arriba: el valor va en la celda de la derecha de cada etiqueta
  [['AGENT NAME', meta.agente, 's'], ['AGENT SAID', meta.said, 's'], ['AGENT MARKET', meta.mercado, 's'], ['DISPUTE SUBMISSION DATE', meta.fecha, 'd']].forEach(function (x) {
    var p = find(x[0]); if (p) set(dispColName_(dispColNum_(p.col) + 1), p.row, x[1], x[2]);
  });
  // tabla: columnas por su título
  var head = find('CUSTOMER ACCOUNT NUMBER');
  if (!head) throw new Error('No encontré la tabla del formato (CUSTOMER ACCOUNT NUMBER).');
  var titles = { activacion: 'ACTIVATION DATE', cuenta: 'CUSTOMER ACCOUNT NUMBER', workOrder: 'WORK ORDER', psu: 'PSU TYPE', bundle: 'BUNDLE NAME',
    lineas: 'MOBILE ADDITIONAL LINES', cliente: 'CUSTOMER FIRST NAME', direccion: 'CUSTOMER ADDRESS', estado: 'STATE', zip: 'ZIP',
    correo: 'CUSTOMER EMAIL', motivo: 'DISPUTE REASON', info: 'ADDITIONAL INFO' };
  var colOf = {};
  Object.keys(text).forEach(function (k) {
    var mm = k.match(/^([A-Z]+)(\d+)$/); if (Number(mm[2]) !== head.row) return;
    Object.keys(titles).forEach(function (f) { if (!colOf[f] && text[k].indexOf(titles[f]) === 0) colOf[f] = mm[1]; });
  });
  rows.forEach(function (r, i) {
    var row = head.row + 1 + i;
    DISP_COLS.forEach(function (f) {
      if (!colOf[f]) return;
      var v = r[f];
      if (v === undefined || v === null || v === '') return;
      if (f === 'activacion') set(colOf[f], row, String(v).slice(0, 10), 'd');
      else if (f === 'lineas') set(colOf[f], row, Number(v) || 0, 'n');
      else set(colOf[f], row, String(v), 's');
    });
  });
  return xml;
}

function dispSetCell_(xml, col, row, val, kind) {
  var ref = col + row;
  var cellXml = function (style) {
    var s = style ? ' s="' + style + '"' : '';
    if (kind === 'd') { var n = dispSerial_(val); if (n !== null) return '<c r="' + ref + '"' + s + '><v>' + n + '</v></c>'; kind = 's'; }
    if (kind === 'n') return '<c r="' + ref + '"' + s + '><v>' + Number(val) + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + dispEsc_(val) + '</t></is></c>';
  };
  var rowRe = new RegExp('<row r="' + row + '"([^>]*?)(?:/>|>([\\s\\S]*?)</row>)');
  var rm = xml.match(rowRe);
  if (!rm) {   // la fila no existe: se crea en su lugar
    var newRow = '<row r="' + row + '">' + cellXml('') + '</row>';
    var after = null;
    xml.replace(/<row r="(\d+)"/g, function (m, n) { if (Number(n) > row && after === null) after = m; return m; });
    if (after) return xml.replace(after, newRow + after);
    return xml.replace('</sheetData>', newRow + '</sheetData>').replace('<sheetData/>', '<sheetData>' + newRow + '</sheetData>');
  }
  var inner = rm[2] || '';
  var cellRe = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
  var cm = inner.match(cellRe);
  var newInner;
  if (cm) {
    var style = (cm[1].match(/\bs="(\d+)"/) || [])[1] || '';
    newInner = inner.replace(cm[0], cellXml(style));
  } else {
    // estilo de la misma columna en la fila de arriba (para que se vea igual)
    var style2 = '';
    var prev = xml.match(new RegExp('<c r="' + col + (row - 1) + '"([^>]*?)(?:/>|>)'));
    if (prev) style2 = (prev[1].match(/\bs="(\d+)"/) || [])[1] || '';
    var target = dispColNum_(col), placed = false;
    newInner = inner.replace(/<c r="([A-Z]+)\d+"/g, function (m, c) {
      if (!placed && dispColNum_(c) > target) { placed = true; return cellXml(style2) + m; }
      return m;
    });
    if (!placed) newInner = inner + cellXml(style2);
  }
  var whole = '<row r="' + row + '"' + rm[1] + '>' + newInner + '</row>';
  return xml.replace(rm[0], whole);
}

/** ▶ Run para probar: busca el formato en tu Gmail y lo llena (sin mandar nada) con hasta 3 comisiones sin pago. */
function probarFormatoDisputa() {
  var t = dispTemplate_();
  Logger.log('Formato encontrado: ' + t.name + ' (llegó el ' + t.fecha + ').');
  var u = escUnpaidInternet_().list.map(function (x) { return x.cuenta; });
  var r = dispRows_(u.slice(0, 3));
  Logger.log(JSON.stringify(r.rows, null, 1));
  if (r.rows.length) { var f = dispFiles_(r.rows); Logger.log('Archivo listo: ' + f[0].name + ' · ' + f[0].blob.getBytes().length + ' bytes'); }
}
