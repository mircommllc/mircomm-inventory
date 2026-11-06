const SPREADSHEET_ID = '1fYPIQh0j_deGwJ_vj1EG5gWOn1oYX5eiVzW0xqt-fgM';
 
const HEADERS = {
  Stock:     ['Barcode','Name','Category','Price','MinQty','Quantity','LastUpdated',
              'Brand','Model','Carrier','DateReceived'],
  Sales:     ['SaleID','Date','Status','Employee','Payment','ItemsJSON',
              'Subtotal','DiscountAmount','DiscountDesc','Tax','Total',
              'VoidedBy','VoidedAt','CustomerPhone','CustomerName',
              'SpectrumAccountName','SpectrumAccountNumber'],
  StockLog:  ['Date','Barcode','Name','QtyReceived','Price'],
  Customers: ['Phone','Name','Email','DOB','Carrier','Zip','ReferralSource',
              'Language','Consent','FirstSeen','LastPurchase','Visits','TotalSpent']
};
 
// ────────────────────────────────────────────────────────────
// HTTP ENTRY POINTS
// ────────────────────────────────────────────────────────────
 
// La entrada del Web App (doGet/doPost) está en Admins.gs: revisa quién entró, guarda el
// historial de cambios y luego llama a estas dos.
function hubGet_(e) {
  prosSessionPin_(e);
  var eq = equipoRouter_(e); if (eq) return eq;
  var cg = conciergeRouter_(e); if (cg) return cg;
  var cr = creditoRouter_(e); if (cr) return cr;
  var sg = seguimientoRouter_(e); if (sg) return sg;
  var ln = lineasRouter_(e); if (ln) return ln;           // v64 · formulario único de líneas (revisa PIN o sesión por su cuenta)
  var gate = authGate_(e); if (gate) return gate;
  var bs = buscarRouter_(e); if (bs) return bs;           // v64 · búsqueda global (Ctrl K)
  var pg = pagosRouter_(e); if (pg) return pg;            // v65 · depósitos de Cellmart leídos del correo (PagosCellmart.gs)
    var nom = nominaRouter_(e); if (nom) return nom;
    var soc = sociosRouter_(e); if (soc) return soc;
     var cr = clientesRouter_(e); if (cr) return cr;
     var pr = prospectosRouter_(e); if (pr) return pr;
     var ar = activacionesRouter_(e); if (ar) return ar;
  try {
    const { action, store } = e.parameter;
    let result;
 
    switch (action) {
      case 'getStock':
        result = getStock(store);
        break;
      case 'getSalesReport':
        result = getSalesReport(store, e.parameter.startDate, e.parameter.endDate);
        break;
      case 'getTransactions':
        result = getTransactions(store, e.parameter.startDate, e.parameter.endDate);
        break;
      case 'getCustomer':
        result = getCustomerByPhone(store, e.parameter.phone);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
 
    return respond(result);
  } catch (err) {
    return respond({ error: err.message });
  }
}
 
function hubPost_(e) {
  var eq = equipoRouter_(e); if (eq) return eq;
  var cg = conciergeRouter_(e); if (cg) return cg;
  var es = escritorioRouter_(e); if (es) return es;
  var rp = reportesRouter_(e); if (rp) return rp;
  var gate = authGate_(e); if (gate) return gate;
    var nom = nominaRouter_(e); if (nom) return nom;
    var soc = sociosRouter_(e); if (soc) return soc;
  try {
    const data = JSON.parse(e.postData.contents);
    let result;
 
    switch (data.action) {
      case 'receiveStock':
        result = receiveStock(data);
        break;
      case 'receiveSerializedItem':
        result = receiveSerializedItem(data);
        break;
      case 'recordSale':
        result = recordSale(data);
        break;
      case 'updateProduct':
        result = updateProduct(data);
        break;
      case 'deleteProduct':
        result = deleteProduct(data);
        break;
      case 'voidSale':
        result = voidSale(data);
        break;
      default:
        result = { error: 'Unknown action: ' + data.action };
    }
 
    return respond(result);
  } catch (err) {
    return respond({ error: err.message });
  }
}
 
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
 
// ────────────────────────────────────────────────────────────
// SHEET HELPERS
// ────────────────────────────────────────────────────────────
 
/** Returns 'Palmhurst' or 'Weslaco' from store key */
function sfx(store) {
  return store === 'palmhurst' ? 'Palmhurst' : 'Weslaco';
}
 
/**
 * Gets (or creates) a named sheet with headers styled in MirComm navy.
 * For sheets that already exist, self-heals the header row by appending
 * any columns present in HEADERS[type] but missing on the live sheet —
 * so adding a field to HEADERS never requires a manual sheet edit.
 * @param {string} type  - 'Stock' | 'Sales' | 'StockLog' | 'Customers'
 * @param {string} store - 'palmhurst' | 'weslaco'
 */
function getSheet(type, store) {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const name = type + '_' + sfx(store);
  let sheet  = ss.getSheetByName(name);
  const hdrs = HEADERS[type];
 
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(hdrs);
    // Style header row in MirComm navy
    const hdr = sheet.getRange(1, 1, 1, hdrs.length);
    hdr.setBackground('#0A1F3C')
       .setFontColor('#FFFFFF')
       .setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Set column widths for readability
    if (type === 'Stock') {
      sheet.setColumnWidth(1, 140); // Barcode
      sheet.setColumnWidth(2, 240); // Name
    }
    if (type === 'Sales') {
      sheet.setColumnWidth(1, 140); // SaleID
      sheet.setColumnWidth(6, 300); // ItemsJSON
    }
  } else {
    ensureHeaders(sheet, hdrs);
  }
 
  return sheet;
}
 
/**
 * Appends any headers from expectedHeaders that aren't already present
 * on the sheet's first row, styled to match. Existing columns and their
 * data are never touched or reordered.
 */
function ensureHeaders(sheet, expectedHeaders) {
  const lastCol  = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const missing  = expectedHeaders.filter(h => existing.indexOf(h) === -1);
  if (missing.length) {
    const startCol = existing.length + 1;
    const range = sheet.getRange(1, startCol, 1, missing.length);
    range.setValues([missing]);
    range.setBackground('#0A1F3C').setFontColor('#FFFFFF').setFontWeight('bold');
  }
}
 
/** Converts a sheet's data rows into an array of plain objects */
function toObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const hdrs = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    hdrs.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}
 
/** Returns a column-index map (0-based) from the first row of a value array */
function colMap(values) {
  return Object.fromEntries(values[0].map((h, i) => [h, i]));
}

/**
 * Parses a "YYYY-MM-DD" date-picker string into a LOCAL Date object,
 * at either the start or end of that calendar day.
 * Using `new Date("YYYY-MM-DD")` directly is a classic Apps Script bug:
 * it's parsed as UTC midnight, and any later .setHours() call then
 * operates in the script's local timezone — which can silently shift
 * the boundary back a full day and cut off "today" from reports.
 */
function parseLocalDate(dateStr, endOfDay) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
}
 
// ────────────────────────────────────────────────────────────
// GET STOCK
// ────────────────────────────────────────────────────────────
 
function getStock(store) {
  return toObjects(getSheet('Stock', store));
}
 
// ────────────────────────────────────────────────────────────
// RECEIVE STOCK
// ────────────────────────────────────────────────────────────
 
function receiveStock(data) {
  const sheet  = getSheet('Stock', data.store);
  const values = sheet.getDataRange().getValues();
  const cols   = colMap(values);
  const barcode = String(data.barcode);
 
  // Find existing row (1-indexed; row 1 = headers)
  let sheetRow = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][cols.Barcode]) === barcode) { sheetRow = i + 1; break; }
  }
 
  const now    = new Date();
  const addQty = parseInt(data.qty) || 0;
 
  if (sheetRow > 0) {
    // Product exists — update fields and add quantity
    const prevQty = parseInt(values[sheetRow - 1][cols.Quantity]) || 0;
    const newQty  = prevQty + addQty;
    sheet.getRange(sheetRow, cols.Name        + 1).setValue(data.name);
    sheet.getRange(sheetRow, cols.Category    + 1).setValue(data.category);
    sheet.getRange(sheetRow, cols.Price       + 1).setValue(parseFloat(data.price));
    sheet.getRange(sheetRow, cols.MinQty      + 1).setValue(parseInt(data.minQty) || 5);
    sheet.getRange(sheetRow, cols.Quantity    + 1).setValue(newQty);
    sheet.getRange(sheetRow, cols.LastUpdated + 1).setValue(now);
    _logReceipt(data, now);
    return { success: true, action: 'updated', newQty };
  } else {
    // New product — append row
    sheet.appendRow([
      barcode,
      data.name,
      data.category,
      parseFloat(data.price),
      parseInt(data.minQty) || 5,
      addQty,
      now
    ]);
    _logReceipt(data, now);
    return { success: true, action: 'added', newQty: addQty };
  }
}
 
function _logReceipt(data, now) {
  getSheet('StockLog', data.store).appendRow([
    now,
    String(data.barcode),
    data.name,
    parseInt(data.qty) || 0,
    parseFloat(data.price)
  ]);
}

// ────────────────────────────────────────────────────────────
// RECEIVE SERIALIZED ITEM  (phones by IMEI, SIM cards by ICCID/serial)
// ────────────────────────────────────────────────────────────
// POST body: { action:'receiveSerializedItem', store, barcode (IMEI/serial),
//              name, category:'Phone'|'SIM Card', price, dateReceived,
//              brand, model,   // phones
//              carrier         // SIM cards }
//
// Each physical unit is its own Stock row at Quantity 1, keyed by its own
// IMEI/serial as the Barcode — unlike accessories, a repeat barcode here
// means the same physical unit was scanned twice, so it's rejected instead
// of being added to an existing quantity.
function receiveSerializedItem(data) {
  const sheet  = getSheet('Stock', data.store);
  const values = sheet.getDataRange().getValues();
  const cols   = colMap(values);
  const barcode = String(data.barcode || '').trim();

  if (!barcode) {
    return { success: false, error: 'Falta el IMEI / Serial.' };
  }

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][cols.Barcode]) === barcode) {
      return { success: false, error: 'Ya existe un artículo en inventario con ese IMEI/Serial: ' + barcode };
    }
  }

  const now = new Date();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowObj = {
    Barcode: barcode,
    Name: data.name || '',
    Category: data.category || '',
    Price: parseFloat(data.price) || 0,
    MinQty: 0,      // serialized units: "Low Stock" doesn't apply the way it does to accessories
    Quantity: 1,
    LastUpdated: now,
    Brand: data.brand || '',
    Model: data.model || '',
    Carrier: data.carrier || '',
    DateReceived: data.dateReceived ? parseLocalDate(data.dateReceived, false) : now
  };
  sheet.appendRow(headers.map(h => (rowObj[h] !== undefined ? rowObj[h] : '')));
  _logReceipt(data, now);

  return { success: true, action: 'added', newQty: 1 };
}
 
// ────────────────────────────────────────────────────────────
// UPDATE PRODUCT  (edit name, category, price, minQty, qty)
// ────────────────────────────────────────────────────────────
// POST body: { action:'updateProduct', store, barcode, name,
//              category, price, minQty, quantity }
 
function updateProduct(data) {
  const sheet  = getSheet('Stock', data.store);
  const values = sheet.getDataRange().getValues();
  const cols   = colMap(values);
  const barcode = String(data.barcode);
 
  let sheetRow = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][cols.Barcode]) === barcode) { sheetRow = i + 1; break; }
  }
 
  if (sheetRow < 0) {
    return { success: false, error: 'Product not found: ' + barcode };
  }
 
  const now = new Date();
  sheet.getRange(sheetRow, cols.Name        + 1).setValue(data.name);
  sheet.getRange(sheetRow, cols.Category    + 1).setValue(data.category);
  sheet.getRange(sheetRow, cols.Price       + 1).setValue(parseFloat(data.price));
  sheet.getRange(sheetRow, cols.MinQty      + 1).setValue(parseInt(data.minQty) || 5);
  sheet.getRange(sheetRow, cols.Quantity    + 1).setValue(parseInt(data.quantity) || 0);
  sheet.getRange(sheetRow, cols.LastUpdated + 1).setValue(now);
 
  return { success: true, action: 'updated' };
}
 
// ────────────────────────────────────────────────────────────
// DELETE PRODUCT  (remove row entirely)
// ────────────────────────────────────────────────────────────
// POST body: { action:'deleteProduct', store, barcode }
 
function deleteProduct(data) {
  const sheet  = getSheet('Stock', data.store);
  const values = sheet.getDataRange().getValues();
  const cols   = colMap(values);
  const barcode = String(data.barcode);
 
  let sheetRow = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][cols.Barcode]) === barcode) { sheetRow = i + 1; break; }
  }
 
  if (sheetRow < 0) {
    return { success: false, error: 'Product not found: ' + barcode };
  }
 
  sheet.deleteRow(sheetRow);
  return { success: true, action: 'deleted', barcode };
}
 
// ────────────────────────────────────────────────────────────
// RECORD SALE
// ────────────────────────────────────────────────────────────
// POST body: { action:'recordSale', store, items:[{barcode,name,category,price,qty}],
//              employee, payment:'cash'|'card',
//              subtotal, discountAmount, discountDesc, tax, total,
//              customer:{phone,name,email,dob,carrier,zip,referral,language,consent} }
 
function recordSale(data) {
  const sheet  = getSheet('Stock', data.store);
  const values = sheet.getDataRange().getValues();
  const cols   = colMap(values);
 
  // ── Gifted-phone rule: a phone can only be given away when it's tied to
  //    a Spectrum account (new or additional line). Enforced server-side
  //    too, so a client-side bug or bypass can't slip a gift through
  //    without the audit trail this whole feature exists to keep. ──
  //    Only PHONES need it: a gifted SIM card (customer brings their own phone, BYOD) doesn't.
  const isPhoneCat = c => /^(phones?|tel[eé]fonos?|celular(es)?|cell ?phones?)$/i.test(String(c || '').trim());
  const hasGift = (data.items || []).some(i => i.gift && isPhoneCat(i.category));
  if (hasGift && (!data.spectrumAccountName || !data.spectrumAccountNumber)) {
    return { success: false, error: 'Falta el nombre o número de cuenta de Spectrum para el teléfono regalado.' };
  }
 
  // ── Validate stock for each item before touching anything ──
  for (const item of data.items) {
    const barcode = String(item.barcode);
    let rowIdx = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][cols.Barcode]) === barcode) { rowIdx = i; break; }
    }
    if (rowIdx < 0) {
      return { success: false, error: `Product not found: "${item.name}"` };
    }
    const available = parseInt(values[rowIdx][cols.Quantity]) || 0;
    if (available < item.qty) {
      return { success: false, error: `Only ${available} of "${item.name}" in stock.` };
    }
  }
 
  // ── Decrement stock ──
  const now = new Date();
  for (const item of data.items) {
    const barcode = String(item.barcode);
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][cols.Barcode]) === barcode) {
        const newQty = (parseInt(values[i][cols.Quantity]) || 0) - item.qty;
        sheet.getRange(i + 1, cols.Quantity    + 1).setValue(newQty);
        sheet.getRange(i + 1, cols.LastUpdated + 1).setValue(now);
        values[i][cols.Quantity] = newQty; // keep in-memory copy consistent
        break;
      }
    }
  }
 
  // ── Log sale ──
  // Built header-driven (not by fixed array position) so this keeps working
  // whether CustomerPhone/CustomerName live where HEADERS.Sales lists them
  // or got appended at the end of an existing sheet by ensureHeaders().
  const saleId = 'S-' + now.getTime();
  const salesSheet   = getSheet('Sales', data.store);
  const salesHeaders = salesSheet.getRange(1, 1, 1, salesSheet.getLastColumn()).getValues()[0];
  const rowObj = {
    SaleID: saleId,
    Date: now,
    Status: 'completed',
    Employee: data.employee || '',
    Payment: data.payment || 'cash',
    ItemsJSON: JSON.stringify(data.items),
    Subtotal: parseFloat(data.subtotal) || 0,
    DiscountAmount: parseFloat(data.discountAmount) || 0,
    DiscountDesc: data.discountDesc || '',
    Tax: parseFloat(data.tax) || 0,
    Total: parseFloat(data.total) || 0,
    VoidedBy: '',
    VoidedAt: '',
    CustomerPhone: (data.customer && data.customer.phone) || '',
    CustomerName: (data.customer && data.customer.name) || '',
    SpectrumAccountName: data.spectrumAccountName || '',
    SpectrumAccountNumber: data.spectrumAccountNumber || ''
  };
  salesSheet.appendRow(salesHeaders.map(h => (rowObj[h] !== undefined ? rowObj[h] : '')));
 
  // ── Upsert customer record ──
  if (data.customer && data.customer.phone) {
    upsertCustomer(data.store, data.customer, parseFloat(data.total) || 0, now);
  }
 
  return { success: true, saleId };
}
 
// ────────────────────────────────────────────────────────────
// CUSTOMERS  (captured at checkout, deduped by phone)
// ────────────────────────────────────────────────────────────
// GET  ?action=getCustomer&store=palmhurst&phone=9560001111
 
function getCustomerByPhone(store, phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return { found: false };
  const customers = toObjects(getSheet('Customers', store));
  const match = customers.find(c => String(c.Phone || '').replace(/\D/g, '') === clean);
  return match ? { found: true, customer: match } : { found: false };
}
 
/**
 * Creates or updates a customer row keyed by phone number.
 * On repeat visits: overwrites any newly-supplied fields (so info can be
 * corrected over time), and always increments Visits / TotalSpent /
 * LastPurchase — never leaves purchase history behind on an update.
 */
function upsertCustomer(store, customer, saleTotal, now) {
  const sheet  = getSheet('Customers', store);
  const values = sheet.getDataRange().getValues();
  const cols   = colMap(values);
  const phone  = String(customer.phone || '').replace(/\D/g, '');
 
  let rowIdx = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][cols.Phone] || '').replace(/\D/g, '') === phone) { rowIdx = i + 1; break; }
  }
 
  if (rowIdx > 0) {
    const prevRow = values[rowIdx - 1];
    sheet.getRange(rowIdx, cols.Name           + 1).setValue(customer.name     || prevRow[cols.Name]);
    sheet.getRange(rowIdx, cols.Email          + 1).setValue(customer.email    || prevRow[cols.Email]);
    sheet.getRange(rowIdx, cols.DOB            + 1).setValue(customer.dob      || prevRow[cols.DOB]);
    sheet.getRange(rowIdx, cols.Carrier        + 1).setValue(customer.carrier  || prevRow[cols.Carrier]);
    sheet.getRange(rowIdx, cols.Zip            + 1).setValue(customer.zip      || prevRow[cols.Zip]);
    sheet.getRange(rowIdx, cols.ReferralSource + 1).setValue(customer.referral || prevRow[cols.ReferralSource]);
    sheet.getRange(rowIdx, cols.Language       + 1).setValue(customer.language || prevRow[cols.Language]);
    sheet.getRange(rowIdx, cols.Consent        + 1).setValue(customer.consent ? 'Yes' : (prevRow[cols.Consent] || 'No'));
    sheet.getRange(rowIdx, cols.LastPurchase   + 1).setValue(now);
    const prevVisits = parseInt(prevRow[cols.Visits]) || 0;
    sheet.getRange(rowIdx, cols.Visits         + 1).setValue(prevVisits + 1);
    const prevSpent = parseFloat(prevRow[cols.TotalSpent]) || 0;
    sheet.getRange(rowIdx, cols.TotalSpent     + 1).setValue(prevSpent + saleTotal);
  } else {
    sheet.appendRow([
      phone,
      customer.name || '',
      customer.email || '',
      customer.dob || '',
      customer.carrier || '',
      customer.zip || '',
      customer.referral || '',
      customer.language || '',
      customer.consent ? 'Yes' : 'No',
      now,        // FirstSeen
      now,        // LastPurchase
      1,          // Visits
      saleTotal   // TotalSpent
    ]);
  }
}
 
// ────────────────────────────────────────────────────────────
// VOID SALE  (mark as voided + restore inventory)
// ────────────────────────────────────────────────────────────
// POST body: { action:'voidSale', store, saleId, voidedBy }
 
function voidSale(data) {
  const salesSheet  = getSheet('Sales', data.store);
  const salesValues = salesSheet.getDataRange().getValues();
  const sCols       = colMap(salesValues);
 
  // Find the sale row
  let saleSheetRow = -1;
  let saleData     = null;
  for (let i = 1; i < salesValues.length; i++) {
    if (String(salesValues[i][sCols.SaleID]) === String(data.saleId)) {
      saleSheetRow = i + 1;
      saleData     = salesValues[i];
      break;
    }
  }
 
  if (saleSheetRow < 0) {
    return { success: false, error: 'Sale not found: ' + data.saleId };
  }
 
  // Check not already voided
  if (String(saleData[sCols.Status]).toLowerCase() === 'voided') {
    return { success: false, error: 'Sale is already voided.' };
  }
 
  // Parse items
  let items = [];
  try { items = JSON.parse(saleData[sCols.ItemsJSON] || '[]'); } catch (_) {}
 
  // ── Restore inventory ──
  const stockSheet  = getSheet('Stock', data.store);
  const stockValues = stockSheet.getDataRange().getValues();
  const iCols       = colMap(stockValues);
 
  for (const item of items) {
    const barcode = String(item.barcode);
    for (let i = 1; i < stockValues.length; i++) {
      if (String(stockValues[i][iCols.Barcode]) === barcode) {
        const restoredQty = (parseInt(stockValues[i][iCols.Quantity]) || 0) + item.qty;
        stockSheet.getRange(i + 1, iCols.Quantity    + 1).setValue(restoredQty);
        stockSheet.getRange(i + 1, iCols.LastUpdated + 1).setValue(new Date());
        stockValues[i][iCols.Quantity] = restoredQty; // keep consistent
        break;
      }
    }
  }
 
  // ── Mark sale as voided ──
  const now = new Date();
  salesSheet.getRange(saleSheetRow, sCols.Status   + 1).setValue('voided');
  salesSheet.getRange(saleSheetRow, sCols.VoidedBy + 1).setValue(data.voidedBy || '');
  salesSheet.getRange(saleSheetRow, sCols.VoidedAt + 1).setValue(now);
 
  return { success: true, action: 'voided', saleId: data.saleId };
}
 
// ────────────────────────────────────────────────────────────
// GET TRANSACTIONS  (history view with optional date filter)
// ────────────────────────────────────────────────────────────
// GET ?action=getTransactions&store=palmhurst&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 
function getTransactions(store, startDate, endDate) {
  const start = startDate ? parseLocalDate(startDate, false) : null;
  const end   = endDate   ? parseLocalDate(endDate, true)    : null;
 
  const sales = toObjects(getSheet('Sales', store));
 
  return sales.filter(s => {
    const d = new Date(s.Date);
    if (start && d < start) return false;
    if (end   && d > end)   return false;
    return true;
  });
}
 
// ────────────────────────────────────────────────────────────
// SALES REPORT  (aggregated summary for Reports tab)
// ────────────────────────────────────────────────────────────
 
function getSalesReport(store, startDate, endDate) {
  const start = parseLocalDate(startDate, false);
  const end   = parseLocalDate(endDate, true);
 
  const stock    = toObjects(getSheet('Stock',    store));
  const sales    = toObjects(getSheet('Sales',    store));
  const stockLog = toObjects(getSheet('StockLog', store));
 
  let totalRevenue = 0, totalSold = 0, totalReceived = 0;
  let cashRevenue  = 0, cardRevenue = 0;
  let totalDiscount = 0, voidedCount = 0;
  const soldMap = {}, rcvdMap = {};
 
  // Aggregate sales (skip voided)
  for (const s of sales) {
    const d = new Date(s.Date);
    if (d < start || d > end) continue;
 
    if (String(s.Status).toLowerCase() === 'voided') { voidedCount++; continue; }
 
    totalRevenue  += parseFloat(s.Total)          || 0;
    totalDiscount += parseFloat(s.DiscountAmount)  || 0;
    if (String(s.Payment).toLowerCase() === 'card') {
      cardRevenue += parseFloat(s.Total) || 0;
    } else {
      cashRevenue += parseFloat(s.Total) || 0;
    }
 
    let items = [];
    try { items = JSON.parse(s.ItemsJSON || '[]'); } catch (_) {}
    for (const item of items) {
      totalSold += item.qty || 0;
      soldMap[item.barcode] = soldMap[item.barcode] || { qty: 0, rev: 0 };
      soldMap[item.barcode].qty += item.qty || 0;
      soldMap[item.barcode].rev += (item.price || 0) * (item.qty || 0);
    }
  }
 
  // Aggregate stock receipts
  for (const l of stockLog) {
    const d = new Date(l.Date);
    if (d < start || d > end) continue;
    const qty = parseInt(l.QtyReceived) || 0;
    totalReceived += qty;
    const bc = String(l.Barcode);
    rcvdMap[bc] = (rcvdMap[bc] || 0) + qty;
  }
 
  // Build per-product rows
  const rows = stock.map(p => ({
    Barcode:  p.Barcode,
    Name:     p.Name,
    Category: p.Category,
    Price:    p.Price,
    Quantity: p.Quantity,
    MinQty:   p.MinQty,
    soldQty:  (soldMap[p.Barcode] || {}).qty || 0,
    soldRev:  (soldMap[p.Barcode] || {}).rev || 0,
    rcvdQty:  rcvdMap[p.Barcode] || 0
  }));
 
  return {
    totalRevenue, totalSold, totalReceived,
    cashRevenue, cardRevenue,
    totalDiscount, voidedCount,
    rows
  };
}

// ────────────────────────────────────────────────────────────
// DAILY SUMMARY EMAIL
// ────────────────────────────────────────────────────────────
// sendDailySummaryEmail() is meant to run on a daily time-based trigger
// (see createDailySummaryTrigger below). It can also be run manually any
// time from the Apps Script editor to send a summary for "today" on demand.

const DAILY_SUMMARY_RECIPIENT = 'mircommllc@gmail.com';

/**
 * Installs (or reinstalls) the daily trigger that sends the summary email.
 * Run this ONCE manually from the Apps Script editor (select this function
 * in the dropdown next to ▶ Run, click Run, approve the permissions prompt).
 * After that it fires on its own every day — no deployment needed for it,
 * triggers always run against the latest saved code.
 *
 * IMPORTANT: atHour(21) means "9pm in whatever time zone this Apps Script
 * project is set to." Check/set it under the ⚙ Project Settings gear icon
 * → Time zone → "(GMT-06:00) Central Time - Chicago" so it actually fires
 * at 9pm Texas time. Trigger times land within roughly an hour of the
 * target, not the exact minute — that's an Apps Script platform limit,
 * not something this code controls.
 */
function createDailySummaryTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailySummaryEmail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailySummaryEmail')
    .timeBased()
    .everyDays(1)
    .atHour(21)
    .create();
}

/** Midnight-to-midnight "today" in the script's local time zone. */
function getTodayRange() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return {
    start: new Date(y, m, d, 0, 0, 0, 0),
    end:   new Date(y, m, d, 23, 59, 59, 999)
  };
}

function sendDailySummaryEmail() {
  const store = 'palmhurst';
  const { start, end } = getTodayRange();
  const dateLabel = Utilities.formatDate(start, Session.getScriptTimeZone(), 'MMMM d, yyyy');

  const sales = toObjects(getSheet('Sales', store)).filter(s => {
    const d = new Date(s.Date);
    return d >= start && d <= end;
  });
  const completed = sales.filter(s => String(s.Status).toLowerCase() !== 'voided');
  const voided    = sales.filter(s => String(s.Status).toLowerCase() === 'voided');

  let totalRevenue = 0, cashRevenue = 0, cardRevenue = 0, totalDiscount = 0;
  const phonesSold = [], phonesGifted = [], simsSold = [];

  for (const s of completed) {
    const total = parseFloat(s.Total) || 0;
    totalRevenue  += total;
    totalDiscount += parseFloat(s.DiscountAmount) || 0;
    if (String(s.Payment).toLowerCase() === 'card') cardRevenue += total; else cashRevenue += total;

    let items = [];
    try { items = JSON.parse(s.ItemsJSON || '[]'); } catch (_) {}
    for (const item of items) {
      if (item.category === 'Phone') {
        const entry = { name: item.name, imei: item.barcode, price: item.price, customer: s.CustomerName || '—' };
        if (item.gift) {
          entry.spectrumName    = s.SpectrumAccountName   || '—';
          entry.spectrumAccount = s.SpectrumAccountNumber || '—';
          phonesGifted.push(entry);
        } else {
          phonesSold.push(entry);
        }
      } else if (item.category === 'SIM Card') {
        simsSold.push({ name: item.name, serial: item.barcode, price: item.price, customer: s.CustomerName || '—' });
      }
    }
  }

  // New customers captured today
  const customers = toObjects(getSheet('Customers', store)).filter(c => {
    const d = new Date(c.FirstSeen);
    return d >= start && d <= end;
  });

  // Stock alerts (current snapshot, not date-filtered)
  const stock = toObjects(getSheet('Stock', store));
  const lowStock = stock.filter(p => {
    const qty = parseInt(p.Quantity) || 0, min = parseInt(p.MinQty) || 0;
    return qty > 0 && qty <= min;
  });
  // Sold-out phones/SIM cards are just normal turnover (each unit is one-of-a-kind
  // and won't be "restocked" the way an accessory would), so they're left out of
  // the "out of stock" alert to avoid cluttering it with every serialized item ever sold.
  const outStock = stock.filter(p =>
    (parseInt(p.Quantity) || 0) === 0 && p.Category !== 'Phone' && p.Category !== 'SIM Card'
  );

  const html = buildDailySummaryHtml({
    dateLabel, totalRevenue, cashRevenue, cardRevenue, totalDiscount,
    completedCount: completed.length, voidedCount: voided.length,
    phonesSold, phonesGifted, simsSold, customers, lowStock, outStock
  });

  MailApp.sendEmail({
    to: DAILY_SUMMARY_RECIPIENT,
    subject: `MirComm Palmhurst — Resumen diario ${dateLabel}`,
    htmlBody: html
  });
}

function buildDailySummaryHtml(d) {
  const money = n => '$' + (n || 0).toFixed(2);
  const row = (label, value) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555">${label}</td><td style="padding:4px 0;font-weight:600">${value}</td></tr>`;

  const phoneRows = (list, isGift) => list.length ? list.map(p => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${p.name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${p.imei}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${isGift ? '🎁 Regalo' : money(p.price)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${p.customer}</td>
      ${isGift ? `<td style="padding:6px 10px;border-bottom:1px solid #eee">${p.spectrumName}<br><span style="color:#888;font-size:11px">${p.spectrumAccount}</span></td>` : ''}
    </tr>`).join('') : `<tr><td colspan="5" style="padding:8px;color:#888">Ninguno</td></tr>`;

  const simRows = d.simsSold.length ? d.simsSold.map(s => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${s.name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${s.serial}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${money(s.price)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${s.customer}</td>
    </tr>`).join('') : `<tr><td colspan="4" style="padding:8px;color:#888">Ninguna</td></tr>`;

  const custRows = d.customers.length ? d.customers.map(c => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.Name || '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.Phone || '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.ReferralSource || '—'}</td>
    </tr>`).join('') : `<tr><td colspan="3" style="padding:8px;color:#888">Ninguno</td></tr>`;

  const stockRows = (list, kind) => list.length ? list.map(p => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${p.Name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${p.Category || '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;color:${kind==='out'?'#c0392b':'#b8860b'}">${p.Quantity}</td>
    </tr>`).join('') : `<tr><td colspan="3" style="padding:8px;color:#888">Ninguno</td></tr>`;

  return `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#222">
    <h2 style="color:#1A6EFF;margin-bottom:0">MirComm Palmhurst</h2>
    <p style="color:#888;margin-top:2px">Resumen diario — ${d.dateLabel}</p>

    <h3 style="margin-bottom:6px">💰 Ventas</h3>
    <table style="border-collapse:collapse">
      ${row('Ingresos totales', money(d.totalRevenue))}
      ${row('Efectivo', money(d.cashRevenue))}
      ${row('Tarjeta', money(d.cardRevenue))}
      ${row('Descuentos otorgados', money(d.totalDiscount))}
      ${row('Transacciones completadas', d.completedCount)}
      ${row('Transacciones canceladas', d.voidedCount)}
    </table>

    <h3 style="margin:20px 0 6px">📱 Teléfonos vendidos</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="background:#f5f5f5"><th align="left" style="padding:6px 10px">Modelo</th><th align="left" style="padding:6px 10px">IMEI</th><th align="left" style="padding:6px 10px">Precio</th><th align="left" style="padding:6px 10px">Cliente</th></tr>
      ${phoneRows(d.phonesSold, false)}
    </table>

    <h3 style="margin:20px 0 6px">🎁 Teléfonos regalados</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="background:#f5f5f5"><th align="left" style="padding:6px 10px">Modelo</th><th align="left" style="padding:6px 10px">IMEI</th><th align="left" style="padding:6px 10px">Estado</th><th align="left" style="padding:6px 10px">Cliente</th><th align="left" style="padding:6px 10px">Cuenta Spectrum</th></tr>
      ${phoneRows(d.phonesGifted, true)}
    </table>

    <h3 style="margin:20px 0 6px">💳 SIM Cards vendidas</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="background:#f5f5f5"><th align="left" style="padding:6px 10px">Compañía</th><th align="left" style="padding:6px 10px">Serial</th><th align="left" style="padding:6px 10px">Precio</th><th align="left" style="padding:6px 10px">Cliente</th></tr>
      ${simRows}
    </table>

    <h3 style="margin:20px 0 6px">🧾 Clientes nuevos capturados hoy</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="background:#f5f5f5"><th align="left" style="padding:6px 10px">Nombre</th><th align="left" style="padding:6px 10px">Teléfono</th><th align="left" style="padding:6px 10px">¿Cómo nos conoció?</th></tr>
      ${custRows}
    </table>

    <h3 style="margin:20px 0 6px">⚠️ Stock bajo</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="background:#f5f5f5"><th align="left" style="padding:6px 10px">Producto</th><th align="left" style="padding:6px 10px">Categoría</th><th align="left" style="padding:6px 10px">Cantidad</th></tr>
      ${stockRows(d.lowStock, 'low')}
    </table>

    <h3 style="margin:20px 0 6px">🚫 Agotados</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="background:#f5f5f5"><th align="left" style="padding:6px 10px">Producto</th><th align="left" style="padding:6px 10px">Categoría</th><th align="left" style="padding:6px 10px">Cantidad</th></tr>
      ${stockRows(d.outStock, 'out')}
    </table>

    <p style="margin-top:24px;color:#888;font-size:11px">Generado automáticamente por el sistema de inventario de MirComm.</p>
  </div>`;
}
