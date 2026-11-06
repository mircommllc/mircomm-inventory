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
  if (p.action !== 'getCustomers') return null;
  var out;
  try {
    out = getCustomersList_(p.store || 'palmhurst');
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
