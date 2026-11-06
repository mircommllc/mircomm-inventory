/**
 * ResumenDiario.gs — Correo diario de MirComm Palmhurst (9 pm) con QUIÉN vendió cada cosa
 * -----------------------------------------------------------------------------
 * Reemplaza al correo de sendDailySummaryEmail (Code.gs). Trae lo mismo de antes y además:
 *  - el nombre de quien vendió junto a cada teléfono, regalo y SIM,
 *  - 🧾 todas las ventas del día (hora, quién, cliente, artículos, pago, total),
 *  - 👤 un resumen por persona,
 *  - 📡 las activaciones registradas hoy y quién las hizo.
 *
 * Usa: SPREADSHEET_ID (Code.gs). Lee las hojas Sales_Palmhurst, Customers_Palmhurst, Stock_Palmhurst y Activations.
 *
 * INSTALAR (una sola vez):
 *  1. Apps Script: ＋ → Script → nómbralo "ResumenDiario" → pega todo este archivo → Guardar.
 *  2. Arriba, en la lista de funciones, escoge instalarResumenDiario → Run.
 *     Quita el aviso diario viejo (sendDailySummaryEmail) y deja este a las 9 pm. No hace falta Deploy.
 *  3. Para probarlo ahora: escoge enviarResumenDiario → Run (manda el de hoy).
 *     Para mandar el de otro día: enviarResumenDe('2026-10-15').
 */

var RD_PARA = 'mircommllc@gmail.com';
var RD_TIENDA = 'Palmhurst';
var RD_HORA = 21;   // 9 pm (zona horaria del proyecto: Central)

function instalarResumenDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'sendDailySummaryEmail' || f === 'enviarResumenDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarResumenDiario').timeBased().atHour(RD_HORA).everyDays(1).create();
  Logger.log('Listo: el resumen diario sale todos los días a las ' + RD_HORA + ':00 a ' + RD_PARA);
}
function enviarResumenDiario() { enviarResumenDe(rdYmd_(new Date())); }

function enviarResumenDe(ymd) {
  var d = rdDatos_(ymd);
  MailApp.sendEmail({ to: RD_PARA, subject: 'MirComm ' + RD_TIENDA + ' — Resumen diario ' + d.dateLabel,
    name: 'MirComm Store Hub', htmlBody: rdHtml_(d) });
}

// ─── Utilidades ────────────────────────────────────────────────────
function rdTz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }
function rdYmd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, rdTz_(), 'yyyy-MM-dd');
  var s = String(v || ''), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  var dt = new Date(s); return isNaN(dt) ? '' : Utilities.formatDate(dt, rdTz_(), 'yyyy-MM-dd');
}
function rdHora_(v) { var dt = v instanceof Date ? v : new Date(v); return isNaN(dt) ? '' : Utilities.formatDate(dt, rdTz_(), 'h:mm a'); }
function rdRows_(name) {
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  return v.slice(1).filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); })
    .map(function (r) { var o = {}; h.forEach(function (k, j) { o[k] = r[j]; }); return o; });
}
function rdEsc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
function rdMoney_(n) { return '$' + (Number(n) || 0).toFixed(2); }
function rdIsPhone_(i) { return /phone/i.test(String(i.category || '')); }
function rdIsSim_(i) { return /sim/i.test(String(i.category || '')); }

// ─── Datos del día ─────────────────────────────────────────────────
function rdDatos_(ymd) {
  var sales = rdRows_('Sales_' + RD_TIENDA).filter(function (s) { return rdYmd_(s.Date) === ymd; })
    .sort(function (a, b) { return new Date(a.Date) - new Date(b.Date); });
  var done = sales.filter(function (s) { return String(s.Status).toLowerCase() !== 'voided'; });
  var d = { ymd: ymd, dateLabel: Utilities.formatDate(new Date(ymd + 'T12:00:00'), rdTz_(), 'MMMM d, yyyy'),
    totalRevenue: 0, cashRevenue: 0, cardRevenue: 0, totalDiscount: 0, completedCount: done.length,
    voidedCount: sales.length - done.length, sales: [], phonesSold: [], phonesGifted: [], sims: [], people: {} };
  var who = function (n) { var p = d.people[n] = d.people[n] || { ventas: 0, total: 0, tels: 0, regalos: 0, lineas: 0, internet: 0 }; return p; };
  sales.forEach(function (s) {
    var items = []; try { items = JSON.parse(s.ItemsJSON || '[]'); } catch (e) {}
    var emp = String(s.Employee || '—'), voided = String(s.Status).toLowerCase() === 'voided';
    var cliente = String(s.CustomerName || ''), total = Number(s.Total) || 0;
    d.sales.push({ hora: rdHora_(s.Date), emp: emp, cliente: cliente, voided: voided, pago: String(s.Payment || ''), total: total,
      items: items.map(function (i) { return i.name + (+i.qty > 1 ? ' ×' + i.qty : '') + (i.gift ? ' (regalo)' : ''); }).join(', ') });
    if (voided) return;
    d.totalRevenue += total; d.totalDiscount += Number(s.DiscountAmount) || 0;
    if (/cash|efectivo/i.test(s.Payment)) d.cashRevenue += total; else d.cardRevenue += total;
    var p = who(emp); p.ventas++; p.total += total;
    items.forEach(function (i) {
      if (rdIsPhone_(i)) {
        var row = { name: i.name, imei: i.barcode || '', price: i.gift ? 0 : (Number(i.price) || 0) * (+i.qty || 1), emp: emp, cliente: cliente,
          spName: String(s.SpectrumAccountName || ''), spAcct: String(s.SpectrumAccountNumber || '') };
        if (i.gift) { d.phonesGifted.push(row); p.regalos++; } else { d.phonesSold.push(row); p.tels++; }
      } else if (rdIsSim_(i)) {
        d.sims.push({ name: i.name, serial: i.barcode || '', price: i.gift ? 0 : (Number(i.price) || 0), emp: emp, cliente: cliente });
      }
    });
  });
  // Activaciones registradas hoy (o con fecha de orden de hoy)
  d.acts = [];
  try {
    rdRows_('Activations').forEach(function (a) {
      if (rdYmd_(a.OrderDate) !== ymd && rdYmd_(a.CreatedAt) !== ymd) return;
      var hecha = String(a.SoldBy || a.Employee || '—'), svc = [];
      if (a.InternetTier) svc.push('🌐 Internet ' + a.InternetTier);
      if (+a.MobileLines > 0) svc.push('📱 ' + a.MobileLines + ' línea' + (+a.MobileLines > 1 ? 's' : '') + (a.MobileType ? ' (' + ({ Primera: 'primera', Incremental: 'incremental', AdicionalNoNuestra: 'adicional' }[a.MobileType] || a.MobileType) + ')' : ''));
      if (a.VideoTier) svc.push('📺 ' + a.VideoTier);
      d.acts.push({ cliente: String(a.CustomerName || ''), cuenta: String(a.AccountNumber || ''), svc: svc.join(' · ') || '—', hecha: hecha,
        activo: a.Source === 'Asesora' && a.EnteredBy && a.EnteredBy !== hecha ? String(a.EnteredBy) : '',
        origen: a.Source === 'Email' ? 'Correo de Spectrum' : a.Source === 'Asesora' ? 'Registrada por ' + (a.EnteredBy || 'asesora') : 'Registro manual',
        fechaOrden: rdYmd_(a.OrderDate) });
      var p = who(hecha);
      if (+a.MobileLines > 0) p.lineas += +a.MobileLines;
      if (a.InternetTier) p.internet++;
    });
  } catch (e) {}
  d.newCustomers = rdRows_('Customers_' + RD_TIENDA).filter(function (c) { return rdYmd_(c.FirstSeen) === ymd; });
  var stock = rdRows_('Stock_' + RD_TIENDA).filter(function (s) { return !/phone|sim/i.test(String(s.Category || '')); });
  d.lowStock = stock.filter(function (s) { var q = Number(s.Quantity); return q > 0 && q <= (Number(s.MinQty) || 0); });
  d.outStock = stock.filter(function (s) { return s.Quantity !== '' && Number(s.Quantity) <= 0; });
  return d;
}

// ─── Correo ────────────────────────────────────────────────────────
function rdHtml_(d) {
  var th = function (cols) { return '<tr style="background:#f5f5f5">' + cols.map(function (c) { return '<th align="left" style="padding:6px 10px">' + c + '</th>'; }).join('') + '</tr>'; };
  var td = function (v, extra) { return '<td style="padding:6px 10px;border-bottom:1px solid #eee' + (extra || '') + '">' + v + '</td>'; };
  var table = function (cols, rows) {
    return '<table style="border-collapse:collapse;width:100%;font-size:13px">' + th(cols) +
      (rows.length ? rows.join('') : '<tr><td colspan="' + cols.length + '" style="padding:8px;color:#888">Ninguno</td></tr>') + '</table>';
  };
  var h3 = function (t) { return '<h3 style="margin:20px 0 6px">' + t + '</h3>'; };
  var row = function (l, v) { return '<tr><td style="padding:4px 14px 4px 0;color:#555">' + l + '</td><td style="padding:4px 0;font-weight:600">' + v + '</td></tr>'; };
  var b = function (s) { return '<b>' + rdEsc_(s) + '</b>'; };
  var people = Object.keys(d.people).sort();

  return '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222">' +
    '<h2 style="color:#1A6EFF;margin-bottom:0">MirComm ' + RD_TIENDA + '</h2>' +
    '<p style="color:#888;margin-top:2px">Resumen diario — ' + rdEsc_(d.dateLabel) + '</p>' +

    h3('💰 Ventas') + '<table style="border-collapse:collapse">' +
      row('Ingresos totales', rdMoney_(d.totalRevenue)) + row('Efectivo', rdMoney_(d.cashRevenue)) + row('Tarjeta', rdMoney_(d.cardRevenue)) +
      row('Descuentos otorgados', rdMoney_(d.totalDiscount)) + row('Transacciones completadas', d.completedCount) + row('Transacciones canceladas', d.voidedCount) +
    '</table>' +

    h3('👤 Por persona') + table(['Persona', 'Ventas', 'Total', 'Teléfonos vendidos', 'Regalados', 'Líneas', 'Internet'],
      people.map(function (n) { var p = d.people[n];
        return '<tr>' + td(b(n)) + td(p.ventas) + td(rdMoney_(p.total)) + td(p.tels) + td(p.regalos) + td(p.lineas) + td(p.internet) + '</tr>'; })) +

    h3('🧾 Ventas del día') + table(['Hora', 'Vendió', 'Cliente', 'Artículos', 'Pago', 'Total'],
      d.sales.map(function (s) {
        var st = s.voided ? ';color:#999;text-decoration:line-through' : '';
        return '<tr>' + td(rdEsc_(s.hora), st) + td(b(s.emp), st) + td(rdEsc_(s.cliente || '—'), st) + td(rdEsc_(s.items), st) +
          td(rdEsc_(s.voided ? 'cancelada' : s.pago === 'cash' ? 'efectivo' : s.pago === 'card' ? 'tarjeta' : s.pago), st) + td(rdMoney_(s.total), st) + '</tr>'; })) +

    h3('📡 Activaciones registradas hoy') + table(['Hecha por', 'Cliente', 'Servicios', 'Cuenta', 'Origen'],
      d.acts.map(function (a) {
        return '<tr>' + td(b(a.hecha) + (a.activo ? '<br><span style="color:#888;font-size:11px">activó ' + rdEsc_(a.activo) + '</span>' : '')) +
          td(rdEsc_(a.cliente) + (a.fechaOrden && a.fechaOrden !== d.ymd ? '<br><span style="color:#888;font-size:11px">orden del ' + rdEsc_(a.fechaOrden) + '</span>' : '')) +
          td(rdEsc_(a.svc)) + td(rdEsc_(a.cuenta)) + td(rdEsc_(a.origen)) + '</tr>'; })) +

    h3('📱 Teléfonos vendidos') + table(['Modelo', 'IMEI', 'Precio', 'Cliente', 'Vendió'],
      d.phonesSold.map(function (p) { return '<tr>' + td(rdEsc_(p.name)) + td(rdEsc_(p.imei)) + td(rdMoney_(p.price)) + td(rdEsc_(p.cliente || '—')) + td(b(p.emp)) + '</tr>'; })) +

    h3('🎁 Teléfonos regalados') + table(['Modelo', 'IMEI', 'Cliente', 'Cuenta Spectrum', 'Vendió'],
      d.phonesGifted.map(function (p) { return '<tr>' + td(rdEsc_(p.name)) + td(rdEsc_(p.imei)) + td(rdEsc_(p.cliente || '—')) +
        td(rdEsc_(p.spName) + (p.spAcct ? '<br>' + rdEsc_(p.spAcct) : '')) + td(b(p.emp)) + '</tr>'; })) +

    h3('💳 SIM Cards vendidas') + table(['Compañía', 'Serial', 'Precio', 'Cliente', 'Vendió'],
      d.sims.map(function (s) { return '<tr>' + td(rdEsc_(s.name)) + td(rdEsc_(s.serial)) + td(rdMoney_(s.price)) + td(rdEsc_(s.cliente || '—')) + td(b(s.emp)) + '</tr>'; })) +

    h3('🧾 Clientes nuevos capturados hoy') + table(['Nombre', 'Teléfono', '¿Cómo nos conoció?'],
      d.newCustomers.map(function (c) { return '<tr>' + td(rdEsc_(c.Name)) + td(rdEsc_(c.Phone)) + td(rdEsc_(c.ReferralSource || '—')) + '</tr>'; })) +

    h3('⚠️ Stock bajo') + table(['Producto', 'Categoría', 'Cantidad'],
      d.lowStock.map(function (p) { return '<tr>' + td(rdEsc_(p.Name)) + td(rdEsc_(p.Category || '—')) + td(rdEsc_(p.Quantity), ';font-weight:600;color:#b8860b') + '</tr>'; })) +

    h3('🚫 Agotados') + table(['Producto', 'Categoría', 'Cantidad'],
      d.outStock.map(function (p) { return '<tr>' + td(rdEsc_(p.Name)) + td(rdEsc_(p.Category || '—')) + td(rdEsc_(p.Quantity), ';font-weight:600;color:#c0392b') + '</tr>'; })) +

    '<p style="margin-top:24px;color:#888;font-size:11px">Generado automáticamente por el sistema de inventario de MirComm.</p></div>';
}
