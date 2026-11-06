/**
 * Clientes.gs — backend de la página "Clientes" (MirComm Inventory).
 *
 * Instalación:
 *  1. En Apps Script: Archivos → "+" → Script → nómbralo "Clientes". Pega este archivo completo.
 *  2. En Code.gs, agrega esta línea como la PRIMERA línea dentro de function doGet(e) { ... }:
 *       var cr = clientesRouter_(e); if (cr) return cr;
 *  3. Deploy → Manage deployments → editar → New version → Deploy.
 *
 * No toca nada más de Code.gs: si la acción no es getCustomers, devuelve null
 * y doGet sigue funcionando igual que antes.
 */
var CLIENTES_SHEET_ID = '1fYPIQh0j_deGwJ_vj1EG5gWOn1oYX5eiVzW0xqt-fgM';

function clientesRouter_(e) {
  var p = (e && e.parameter) || {};
  var a = p.action;
  if (a !== 'getCustomers' && a !== 'getCustomerSummary' && a !== 'getCustomerHistory') return null;
  var out;
  try {
    if (a === 'getCustomerSummary') out = getCustomerSummary_(p.store || 'palmhurst');
    else if (a === 'getCustomerHistory') out = getCustomerHistory_(p.store || 'palmhurst', p.phone);
    else out = getCustomersList_(p.store || 'palmhurst');
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function getCustomersList_(store) {
  var s = String(store);
  var sheetName = 'Customers_' + s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  var sh = SpreadsheetApp.openById(CLIENTES_SHEET_ID).getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var headers = values.shift().map(String);
  var tz = Session.getScriptTimeZone();
  return values
    .filter(function (r) { return r.some(function (v) { return v !== ''; }); })
    .map(function (r) {
      var o = {};
      headers.forEach(function (h, i) {
        var v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        o[h] = v;
      });
      return o;
    });
}

// ─── v64 · Fase 2: el resumen de cada cliente se calcula aquí, no en el navegador ─────────────
// Antes la página Customers bajaba TODAS las ventas desde 2020 para contar visitas y total gastado.
// Ahora el backend lee la hoja de ventas una vez y regresa solo el resumen por cliente.
// El historial de compras de un cliente se pide aparte (getCustomerHistory) cuando abres su ficha.
function custPhone_(v) { return String(v === null || v === undefined ? '' : v).replace(/\D/g, '').slice(-10); }
function custSalesByPhone_(store) {
  var sh = getSheet('Sales', store);
  var v = sh.getDataRange().getValues();
  var H = v.shift().map(String);
  var cPhone = H.indexOf('CustomerPhone'), cDate = H.indexOf('Date'), cStatus = H.indexOf('Status'), cTotal = H.indexOf('Total');
  var by = {};
  if (cPhone < 0) return { by: by, H: H, rows: v };
  v.forEach(function (r, i) {
    var ph = custPhone_(r[cPhone]);
    if (ph.length !== 10) return;
    (by[ph] = by[ph] || []).push(i);
  });
  return { by: by, H: H, rows: v, c: { date: cDate, status: cStatus, total: cTotal } };
}
function getCustomerSummary_(store) {
  var tz = Session.getScriptTimeZone();
  var custs = getCustomersList_(store);
  var S = custSalesByPhone_(store);
  var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var ymd = function (d) { return d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : ''; };
  var asDate = function (x) {
    if (x instanceof Date) return x;
    var m = String(x || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var d = x ? new Date(x) : null; return d && !isNaN(d) ? d : null;
  };
  var stats = { total: 0, active30: 0, lapsed90: 0, sms: 0 };
  var list = custs.map(function (c) {
    var phone = custPhone_(c.Phone || c.Telefono || c['Teléfono']);
    var idx = S.by[phone] || [], last = null, first = null, visits = 0, spent = 0;
    if (S.c && idx.length) {
      idx.forEach(function (i) {
        var r = S.rows[i];
        if (String(r[S.c.status]).toLowerCase() === 'voided') return;
        var d = asDate(r[S.c.date]);
        visits++; spent += parseFloat(r[S.c.total]) || 0;
        if (d && (!last || d > last)) last = d;
        if (d && (!first || d < first)) first = d;
      });
    }
    if (!visits) {   // ventas viejas sin teléfono: lo que ya trae la hoja de clientes
      last = asDate(c.LastPurchase || c.LastVisit); visits = parseInt(c.Visits, 10) || 0; spent = parseFloat(c.TotalSpent) || 0;
    }
    var fs = asDate(c.FirstSeen); if (fs && (!first || fs < first)) first = fs;
    var days = last ? Math.floor((today - new Date(last.getFullYear(), last.getMonth(), last.getDate())) / 86400000) : null;
    var consent = String(c.Consent).toLowerCase() === 'yes' || c.Consent === true;
    stats.total++; if (days !== null && days <= 30) stats.active30++; if (days !== null && days > 90) stats.lapsed90++; if (consent) stats.sms++;
    return { Phone: phone, Name: String(c.Name || c.Nombre || ''), Email: String(c.Email || ''), DOB: c.DOB || '', Carrier: String(c.Carrier || ''),
      Zip: String(c.Zip || ''), ReferralSource: String(c.ReferralSource || ''), Language: String(c.Language || ''), Consent: consent,
      first: ymd(first), last: ymd(last), visits: visits, spent: Math.round(spent * 100) / 100, daysSince: days };
  });
  return { ok: true, generated: Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ss"), stats: stats, customers: list };
}
function getCustomerHistory_(store, phone) {
  var ph = custPhone_(phone);
  if (ph.length !== 10) throw new Error('Teléfono no válido.');
  var S = custSalesByPhone_(store), tz = Session.getScriptTimeZone();
  return { ok: true, phone: ph, sales: (S.by[ph] || []).map(function (i) {
    var o = {};
    S.H.forEach(function (h, j) { var x = S.rows[i][j]; o[h] = x instanceof Date ? Utilities.formatDate(x, tz, "yyyy-MM-dd'T'HH:mm:ss") : x; });
    return o;
  }).sort(function (a, b) { return String(b.Date).localeCompare(String(a.Date)); }) };
}
