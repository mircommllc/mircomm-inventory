/**
 * Socios.gs — 🤝 Socios (el Partner Commission Tracker, ahora dentro del MirComm App)
 *
 * Los datos se quedan en el mismo Google Sheet "MirComm Commissions" (pestañas Partners y Referrals).
 * No se borra ni se reordena ninguna columna: las nuevas se agregan al final. Se crea sola una pestaña "Pagos".
 *
 * INSTALACIÓN (una sola vez):
 *  1. Apps Script del MirComm App → ＋ (Archivo nuevo) → Script → nómbralo "Socios" y pega este archivo completo. Guarda.
 *  2. En Code.gs, dentro de doGet(e) Y dentro de doPost(e), justo DEBAJO de la línea de nómina:
 *         var nom = nominaRouter_(e); if (nom) return nom;
 *     pega esta otra:
 *         var soc = sociosRouter_(e); if (soc) return soc;
 *  3. Deploy → Manage deployments → ✏️ → Version: New version → Deploy. (NUNCA "New deployment".)
 *     Si Google pide permisos otra vez, acéptalos (es para abrir el Sheet de comisiones).
 *  La primera vez que abras 🤝 Socios se arreglan solas las fechas viejas, se ponen los planes
 *  (Imelda $80 fijo, los demás escalonado) y se recalculan SOLO los referidos sin pagar.
 *
 * REGLAS (se cambian desde ⚙ Reglas en la app):
 *  - Spectrum: escalonado por mes calendario de la fecha de venta → ventas 1–10 = $75, de la 11 en adelante = $100.
 *    No es retroactivo. Socios con plan fijo (Imelda) = $80 por venta de Spectrum.
 *  - AT&T, Viasat y Tracfone: $40 fijos para todos (también Imelda) y NO cuentan para el escalón.
 *  - Una sola comisión por venta (el internet). Solo líneas móviles = $0.
 *  - Lo ya pagado nunca se recalcula.
 *  - Pago al socio: cuando te pagan (Cellmart o la compañía) + 7 días.
 *
 * Todas las acciones son solo del manager (las revisa authGate_ con la sesión de Joel).
 */

var SOC_SHEET_ID = '1ROb1-RpkIMG9N1cfUIctoL8Ogh5RK9TON1EpcPJ4mlQ';
var SOC_TABS = {
  partners: { name: 'Partners', headers: ['id', 'name', 'phone', 'property', 'rate', 'payment', 'createdAt',
    'rateType', 'flatRate', 'pendingDebt', 'payHandle', 'active', 'notes'] },
  referrals: { name: 'Referrals', headers: ['id', 'name', 'phone', 'address', 'partnerId', 'package', 'commission',
    'saleDate', 'installDate', 'paymentDate', 'status', 'paidDate', 'notes', 'createdAt',
    'carrier', 'account', 'actId', 'commissionManual', 'dispositionNote', 'chargebackDate', 'chargebackAmount',
    'chargebackDeducted', 'paidToMeDate', 'payId', 'cbPayId', 'source', 'updatedAt'] },
  pays: { name: 'Pagos', headers: ['id', 'partnerId', 'partnerName', 'date', 'method', 'gross', 'deductions', 'net',
    'carryOver', 'prevDebt', 'items', 'chargebacks', 'note', 'createdAt'] }
};
var SOC_TEXT_COLS = ['id', 'partnerId', 'phone', 'account', 'actId', 'saleDate', 'installDate', 'paymentDate', 'paidDate',
  'chargebackDate', 'paidToMeDate', 'date'];
var SOC_DATE_COLS = ['saleDate', 'installDate', 'paymentDate', 'paidDate', 'chargebackDate', 'paidToMeDate', 'date'];
var SOC_DEFAULT_CONFIG = { tierCut: 10, tier1: 75, tier2: 100, flat: 80, other: 40, delayDays: 7, deadlineDays: 45,
  cbDays: 90, estDays: 45 };
var SOC_CARRIERS = ['Spectrum', 'AT&T', 'Viasat', 'Tracfone'];
var SOC_SALE = { pending: 1, paid: 1, chargedback: 1 };
var SOC_ACTIONS = { socGet: 1, socLinks: 1, socSavePartner: 1, socDeletePartner: 1, socSaveReferral: 1,
  socDeleteReferral: 1, socPay: 1, socUndoPay: 1, socChargeback: 1, socPaidToMe: 1, socLink: 1, socSaveConfig: 1 };

function sociosRouter_(e) {
  var p = {};
  var src = (e && e.parameter) || {};
  for (var k in src) p[k] = src[k];
  if (e && e.postData && e.postData.contents) {
    try { var b = JSON.parse(e.postData.contents); for (var j in b) p[j] = b[j]; } catch (err) {}
  }
  var a = String(p.action || '');
  if (!SOC_ACTIONS[a]) return null;
  var out;
  try {
    socMigrate_();
    if (a === 'socGet') out = socState_();
    else if (a === 'socLinks') out = socLinks_();
    else out = socWrite_(a, p);
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function socWrite_(a, p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = nomJson_(p.data) || {}, extra = {};
    if (a === 'socSavePartner') extra.id = socSavePartner_(d);
    else if (a === 'socDeletePartner') extra.result = socDeletePartner_(String(p.id || d.id || ''));
    else if (a === 'socSaveReferral') extra.id = socSaveReferral_(d);
    else if (a === 'socDeleteReferral') socDeleteReferral_(String(p.id || d.id || ''));
    else if (a === 'socPay') extra.pay = socPay_(d);
    else if (a === 'socUndoPay') socUndoPay_(String(p.id || d.id || ''));
    else if (a === 'socChargeback') socChargeback_(d);
    else if (a === 'socPaidToMe') socPaidToMe_(d);
    else if (a === 'socLink') extra.id = socLink_(d);
    else if (a === 'socSaveConfig') socSaveConfig_(d);
    socRecalc_();
    if (a === 'socLink') { var L = socLinks_(); L.id = extra.id; return L; }
    var st = socState_();
    for (var x in extra) st[x] = extra[x];
    return st;
  } finally {
    lock.releaseLock();
  }
}

// ─── Hojas ────────────────────────────────────────────────────────────
var SOC_CACHE_ = {};
function socSS_() {
  if (!SOC_CACHE_.ss) SOC_CACHE_.ss = SpreadsheetApp.openById(SOC_SHEET_ID);
  return SOC_CACHE_.ss;
}
// Abre la pestaña y agrega al final las columnas que falten (nunca mueve ni borra las que ya hay)
function socTab_(key) {
  if (SOC_CACHE_[key]) return SOC_CACHE_[key];
  var def = SOC_TABS[key], ss = socSS_();
  var sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
      .setBackground('#0A1F3C').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var lc = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h || '').trim(); });
  while (head.length && !head[head.length - 1]) head.pop();
  var missing = def.headers.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
  }
  SOC_CACHE_[key] = { sh: sh, head: head };
  return SOC_CACHE_[key];
}
function socRead_(key) {
  var t = socTab_(key), sh = t.sh, lr = sh.getLastRow();
  if (lr < 2) return [];
  var v = sh.getRange(2, 1, lr - 1, t.head.length).getValues();
  var out = [];
  v.forEach(function (r, i) {
    if (r.every(function (c) { return c === '' || c === null; })) return;
    var o = { _row: i + 2 };
    t.head.forEach(function (h, c) {
      if (!h) return;
      var x = r[c];
      if (SOC_DATE_COLS.indexOf(h) >= 0) o[h] = socYmd_(x);
      else if (nomIsDate_(x)) o[h] = h === 'createdAt' ? x.toISOString() : socYmd_(x);
      else o[h] = x === null || x === undefined ? '' : String(x);
    });
    out.push(o);
  });
  return out;
}
var SOC_NUM_COLS = ['rate', 'flatRate', 'pendingDebt', 'commission', 'chargebackAmount', 'gross', 'deductions', 'net', 'carryOver', 'prevDebt'];
function socRowValues_(head, o) {
  return head.map(function (h) {
    if (!h) return '';
    var x = o[h];
    if (x === undefined || x === null) return '';
    if (SOC_NUM_COLS.indexOf(h) >= 0 && x !== '' && isFinite(+x)) return +x;
    return x;
  });
}
function socTextFormat_(t, row, n) {
  t.head.forEach(function (h, c) {
    if (SOC_TEXT_COLS.indexOf(h) >= 0) t.sh.getRange(row, c + 1, n || 1, 1).setNumberFormat('@');
  });
}
function socSave_(key, o) {
  var t = socTab_(key);
  var row = o._row || Math.max(t.sh.getLastRow(), 1) + 1;
  socTextFormat_(t, row, 1);
  t.sh.getRange(row, 1, 1, t.head.length).setValues([socRowValues_(t.head, o)]);
  o._row = row;
}
function socDelete_(key, o) { socTab_(key).sh.deleteRow(o._row); }

// Fechas: Date, "Thu Mar 26 2026 00:00:00 GMT-0500 (Central …)", ISO o m/d/yyyy → yyyy-mm-dd
function socYmd_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (nomIsDate_(v)) return nomYmd_(v);
  var s = String(v).trim();
  if (!s || s === 'TBD') return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && s.length <= 10) return s.slice(0, 10);
  if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{4}/.test(s) || /T\d{2}:\d{2}/.test(s)) {
    var d = new Date(s.replace(/\s*\(.*\)\s*$/, ''));
    if (!isNaN(d.getTime())) return nomYmd_(d);
  }
  return nomYmd_(s);
}
function socNum_(v) { var n = parseFloat(String(v === undefined ? '' : v).replace(/[$,]/g, '')); return isFinite(n) ? n : 0; }
function socNowIso_() { return new Date().toISOString(); }
function socNewId_() { Utilities.sleep(2); return String(Date.now()); }
function socDigits_(v) { return String(v || '').replace(/\D/g, '').slice(-10); }
function socNorm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ')
    .split(/\s+/).filter(function (w) { return w; });
}

function socConfig_() {
  var c = {}, k;
  for (k in SOC_DEFAULT_CONFIG) c[k] = SOC_DEFAULT_CONFIG[k];
  try {
    var saved = JSON.parse(PropertiesService.getScriptProperties().getProperty('SOC_CONFIG') || '{}');
    for (k in saved) if (k in c && isFinite(+saved[k])) c[k] = +saved[k];
  } catch (e) {}
  return c;
}
function socSaveConfig_(d) {
  var c = socConfig_();
  for (var k in c) if (d[k] !== undefined && d[k] !== '' && isFinite(+d[k]) && +d[k] >= 0) c[k] = +d[k];
  PropertiesService.getScriptProperties().setProperty('SOC_CONFIG', JSON.stringify(c));
}

// ─── Reglas de comisión ──────────────────────────────────────────────
function socCarrier_(r) {
  if (SOC_CARRIERS.indexOf(r.carrier) >= 0) return r.carrier;
  var t = String(r.package || '') + ' ' + String(r.notes || '');
  if (/viasat/i.test(t)) return 'Viasat';
  if (/tracfone/i.test(t)) return 'Tracfone';
  if (/at\s*&\s*t|\batt\b|fibra|fiber/i.test(t)) return 'AT&T';
  if (/spectrum/i.test(t)) return 'Spectrum';
  return 'Other';
}
function socMobileOnly_(r) { return /solo m[oó]vil|mobile only|^spectrum mobile$/i.test(String(r.package || '').trim()); }
function socSortKey_(r) { return (r.saleDate || '9999') + '|' + (r.createdAt || '') + '|' + r.id; }

// Comisión que le toca a un referido SIN pagar (null = no se toca)
function socRule_(r, partner, all, cfg) {
  var st = r.status || 'lead';
  if (st !== 'lead' && st !== 'pending') return null;
  if (String(r.commissionManual) === 'yes') return null;
  var car = socCarrier_(r);
  if (car !== 'Spectrum') return cfg.other;
  if (socMobileOnly_(r)) return 0;
  if (partner && partner.rateType === 'flat') return socNum_(partner.flatRate) || cfg.flat;
  if (st === 'lead' || !r.saleDate) return cfg.tier1;
  var month = r.saleDate.slice(0, 7), key = socSortKey_(r);
  var n = all.filter(function (x) {
    return x.partnerId === r.partnerId && SOC_SALE[x.status] && x.saleDate && x.saleDate.slice(0, 7) === month &&
      socCarrier_(x) === 'Spectrum' && !socMobileOnly_(x) && socSortKey_(x) <= key;
  }).length;
  return n <= cfg.tierCut ? cfg.tier1 : cfg.tier2;
}
function socRecalc_() {
  var cfg = socConfig_(), P = socRead_('partners'), R = socRead_('referrals'), byId = {};
  P.forEach(function (p) { byId[p.id] = p; });
  var n = 0;
  R.forEach(function (r) {
    var c = socRule_(r, byId[r.partnerId], R, cfg);
    var car = SOC_CARRIERS.indexOf(r.carrier) < 0 ? socCarrier_(r) : r.carrier;
    if ((c !== null && String(r.commission) !== String(c)) || (car !== 'Other' && car !== r.carrier)) {
      if (c !== null) r.commission = c;
      r.carrier = car === 'Other' ? r.carrier : car;
      socSave_('referrals', r); n++;
    }
  });
  return n;
}

// ─── Arreglo único de los datos viejos ───────────────────────────────
function socMigrate_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SOC_MIGRATED') === '2') return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (props.getProperty('SOC_MIGRATED') === '2') return;
    var cfg = socConfig_();
    var P = socRead_('partners'), R = socRead_('referrals');    // se lee ANTES de cambiar el formato de las celdas
    ['partners', 'referrals', 'pays'].forEach(function (k) {
      var t = socTab_(k), rows = Math.max(t.sh.getMaxRows() - 1, 1);
      socTextFormat_(t, 2, rows);
    });
    P.forEach(function (p) {
      if (!p.rateType) {
        var rate = socNum_(p.rate);
        p.rateType = rate >= 80 ? 'flat' : 'tiered';
        p.flatRate = rate >= 80 ? rate : '';
        p.rate = rate >= 80 ? rate : cfg.tier1;
      }
      if (!p.active) p.active = 'yes';
      if (p.pendingDebt === '') p.pendingDebt = 0;
    });
    socWriteAll_('partners', P);
    R.forEach(function (r) {
      var car = socCarrier_(r);
      if (!r.carrier && car !== 'Other') r.carrier = car;
      if (!r.source) r.source = 'portal';
      if (r.chargebackDeducted === '') r.chargebackDeducted = r.status === 'chargedback' ? 'false' : '';
    });
    socWriteAll_('referrals', R);
    SOC_CACHE_ = {};
    socRecalc_();
    props.setProperty('SOC_MIGRATED', '2');
  } finally {
    lock.releaseLock();
  }
}
function socWriteAll_(key, rows) {
  if (!rows.length) return;
  var t = socTab_(key);
  rows.forEach(function (o) { t.sh.getRange(o._row, 1, 1, t.head.length).setValues([socRowValues_(t.head, o)]); });
}

// ─── Lectura ─────────────────────────────────────────────────────────
function socClean_(o) { var c = {}; for (var k in o) if (k !== '_row') c[k] = o[k]; return c; }
function socState_() {
  var R = socRead_('referrals');
  var acts = socActs_(150), linked = {};
  R.forEach(function (r) { if (r.actId) linked[r.actId] = 1; });
  var cm = {};
  nomReadOpt_('Nomina_Cellmart').forEach(function (s) {
    var id = String(s.ID || '');
    if (linked[id]) cm[id] = { ComCode: String(s.ComCode || ''), CoreCode: String(s.CoreCode || ''), ConnDate: nomYmd_(s.ConnDate),
      PayDate: nomYmd_(s.PayDate), PaidAmt: s.PaidAmt, ChargeAmt: s.ChargeAmt, ChargeDate: nomYmd_(s.ChargeDate) };
  });
  // Activaciones vinculadas que ya no están en la ventana de 150 días
  var have = {};
  acts.forEach(function (a) { have[a.ID] = 1; });
  if (Object.keys(linked).some(function (id) { return !have[id]; }))
    socActs_(0).forEach(function (a) { if (linked[a.ID] && !have[a.ID]) acts.push(a); });
  var pays = socRead_('pays').map(socClean_).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return {
    ok: true, today: nomYmd_(new Date()), config: socConfig_(),
    partners: socRead_('partners').map(socClean_), referrals: R.map(socClean_),
    pays: pays.slice(0, 300), cm: cm, acts: acts
  };
}
function socActs_(days) {
  var cut = days ? nomYmd_(new Date(Date.now() - days * 86400000)) : '';
  return nomReadOpt_('Activations').filter(function (a) { return a.ID && (!cut || nomYmd_(a.OrderDate) >= cut); })
    .map(function (a) {
      return { ID: String(a.ID), OrderDate: nomYmd_(a.OrderDate), CustomerName: String(a.CustomerName || ''),
        AccountNumber: String(a.AccountNumber || ''), Phone: String(a.Phone || ''), InternetTier: String(a.InternetTier || ''),
        VideoTier: String(a.VideoTier || ''), MobileLines: String(a.MobileLines || ''), SoldBy: String(a.SoldBy || a.Employee || ''),
        RepID: String(a.RepID || '') };
    });
}
// Lo poquito que necesita 📡 Activaciones: socios activos y qué activación está ligada a cuál socio
function socLinks_() {
  var links = {};
  socRead_('referrals').forEach(function (r) {
    if (r.actId) links[r.actId] = { refId: r.id, partnerId: r.partnerId, status: r.status, commission: socNum_(r.commission) };
  });
  return { ok: true, links: links,
    partners: socRead_('partners').map(function (p) { return { id: p.id, name: p.name, active: p.active !== 'no' }; }) };
}

// ─── Socios ──────────────────────────────────────────────────────────
function socSavePartner_(d) {
  var name = String(d.name || '').trim();
  if (!name) throw new Error('Escribe el nombre del socio.');
  var cfg = socConfig_(), P = socRead_('partners');
  var p = d.id ? P.filter(function (x) { return x.id === String(d.id); })[0] : null;
  if (d.id && !p) throw new Error('No encontré ese socio.');
  if (!p) p = { id: socNewId_(), createdAt: socNowIso_(), pendingDebt: 0 };
  var flat = d.rateType === 'flat';
  p.name = name;
  p.phone = String(d.phone || '').trim();
  p.property = String(d.property || '').trim();
  p.payment = String(d.payment || 'Zelle').trim();
  p.payHandle = String(d.payHandle || '').trim();
  p.rateType = flat ? 'flat' : 'tiered';
  p.flatRate = flat ? (socNum_(d.flatRate) || cfg.flat) : '';
  p.rate = flat ? p.flatRate : cfg.tier1;
  p.active = d.active === false || d.active === 'no' ? 'no' : 'yes';
  p.notes = String(d.notes || '').trim();
  socSave_('partners', p);
  return p.id;
}
function socDeletePartner_(id) {
  var p = socRead_('partners').filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('No encontré ese socio.');
  if (socRead_('referrals').some(function (r) { return r.partnerId === id; })) {
    p.active = 'no'; socSave_('partners', p); return 'inactive';
  }
  socDelete_('partners', p);
  return 'deleted';
}

// ─── Referidos ───────────────────────────────────────────────────────
var SOC_LOST = { 'lost-direct': 1, 'lost-existing': 1, 'lost-other': 1 };
function socSaveReferral_(d) {
  var R = socRead_('referrals'), P = socRead_('partners');
  var r = d.id ? R.filter(function (x) { return x.id === String(d.id); })[0] : null;
  if (d.id && !r) throw new Error('No encontré ese referido.');
  var s = function (k) { return String(d[k] === undefined || d[k] === null ? '' : d[k]).trim(); };
  var locked = r && (r.status === 'paid' || r.status === 'chargedback');
  if (!s('name')) throw new Error('Escribe el nombre del cliente.');
  if (!locked && !P.some(function (p) { return p.id === s('partnerId'); })) throw new Error('Escoge el socio.');
  if (!r) r = { id: socNewId_(), createdAt: socNowIso_(), status: 'lead', source: 'app', chargebackAmount: '', chargebackDeducted: '' };
  r.name = s('name'); r.phone = s('phone'); r.address = s('address'); r.notes = s('notes');
  if (d.account !== undefined) r.account = s('account').replace(/\D/g, '');
  if (!locked) {
    r.partnerId = s('partnerId');
    r.carrier = SOC_CARRIERS.indexOf(s('carrier')) >= 0 ? s('carrier') : socCarrier_({ package: s('package') });
    r.package = s('package');
    r.saleDate = socYmd_(s('saleDate'));
    r.installDate = socYmd_(s('installDate'));
    if (d.paymentDate !== undefined) r.paymentDate = socYmd_(s('paymentDate'));
    var st = s('status') || (r.saleDate ? 'pending' : r.status || 'lead');
    if (st !== 'lead' && st !== 'pending' && !SOC_LOST[st]) st = 'lead';
    if (st === 'pending' && !r.saleDate) throw new Error('Para marcarlo como venta, pon la fecha de venta.');
    r.status = st;
    r.dispositionNote = SOC_LOST[st] ? s('dispositionNote') : '';
    r.commissionManual = d.commissionManual === true || d.commissionManual === 'yes' ? 'yes' : '';
    if (r.commissionManual) r.commission = socNum_(d.commission);
    if (d.paidToMeDate !== undefined) r.paidToMeDate = socYmd_(s('paidToMeDate'));
  }
  r.updatedAt = socNowIso_();
  socSave_('referrals', r);
  return r.id;
}
function socDeleteReferral_(id) {
  var r = socRead_('referrals').filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('No encontré ese referido.');
  if (r.status === 'paid' || r.status === 'chargedback') throw new Error('Ya está pagado: no se puede borrar.');
  socDelete_('referrals', r);
}
function socPaidToMe_(d) {
  var ids = d.ids || [], date = socYmd_(d.date);
  socRead_('referrals').forEach(function (r) {
    if (ids.indexOf(r.id) >= 0 && r.status !== 'paid') { r.paidToMeDate = date; r.updatedAt = socNowIso_(); socSave_('referrals', r); }
  });
}
function socChargeback_(d) {
  var r = socRead_('referrals').filter(function (x) { return x.id === String(d.id); })[0];
  if (!r) throw new Error('No encontré ese referido.');
  if (d.undo) {
    if (r.status !== 'chargedback') return;
    if (r.chargebackDeducted === 'true' && socNum_(r.chargebackAmount) > 0) throw new Error('Ese chargeback ya se descontó en un pago.');
    r.status = r.paidDate ? 'paid' : 'pending';
    r.chargebackDate = ''; r.chargebackAmount = ''; r.chargebackDeducted = '';
    if (r.dispositionNote === 'Chargeback antes de pagarle al socio') r.dispositionNote = '';
  } else {
    if (r.status !== 'paid' && r.status !== 'pending') throw new Error('Solo se le hace chargeback a una venta.');
    r.chargebackDate = socYmd_(d.date) || nomYmd_(new Date());
    if (r.status === 'paid') {
      r.chargebackAmount = socNum_(r.commission); r.chargebackDeducted = 'false';
    } else {                                     // nunca se le pagó: no hay nada que descontar
      r.chargebackAmount = 0; r.chargebackDeducted = 'true'; r.dispositionNote = 'Chargeback antes de pagarle al socio';
    }
    r.status = 'chargedback';
  }
  r.updatedAt = socNowIso_();
  socSave_('referrals', r);
}

// ─── Pagar al socio ──────────────────────────────────────────────────
function socPay_(d) {
  var P = socRead_('partners'), R = socRead_('referrals');
  var p = P.filter(function (x) { return x.id === String(d.partnerId); })[0];
  if (!p) throw new Error('No encontré ese socio.');
  var ids = d.ids || [];
  var items = R.filter(function (r) { return r.partnerId === p.id && r.status === 'pending' && ids.indexOf(r.id) >= 0; });
  if (!items.length) throw new Error('Escoge al menos una venta para pagar.');
  var cbs = R.filter(function (r) {
    return r.partnerId === p.id && r.status === 'chargedback' && r.chargebackDeducted !== 'true' && socNum_(r.chargebackAmount) > 0;
  });
  var gross = items.reduce(function (s, r) { return s + socNum_(r.commission); }, 0);
  var prevDebt = socNum_(p.pendingDebt);
  var ded = cbs.reduce(function (s, r) { return s + socNum_(r.chargebackAmount); }, 0) + prevDebt;
  var net = Math.max(0, gross - ded), carry = Math.max(0, ded - gross);
  var date = socYmd_(d.date) || nomYmd_(new Date());
  var pay = { id: 'PP' + socNewId_(), partnerId: p.id, partnerName: p.name, date: date,
    method: String(d.method || p.payment || 'Zelle'), gross: gross, deductions: ded, net: net, carryOver: carry, prevDebt: prevDebt,
    items: JSON.stringify(items.map(function (r) { return { id: r.id, name: r.name, saleDate: r.saleDate, carrier: socCarrier_(r), amt: socNum_(r.commission) }; })),
    chargebacks: JSON.stringify(cbs.map(function (r) { return { id: r.id, name: r.name, date: r.chargebackDate, amt: socNum_(r.chargebackAmount) }; })),
    note: String(d.note || ''), createdAt: socNowIso_() };
  items.forEach(function (r) { r.status = 'paid'; r.paidDate = date; r.payId = pay.id; r.updatedAt = pay.createdAt; socSave_('referrals', r); });
  cbs.forEach(function (r) { r.chargebackDeducted = 'true'; r.cbPayId = pay.id; r.updatedAt = pay.createdAt; socSave_('referrals', r); });
  p.pendingDebt = carry;
  socSave_('partners', p);
  socSave_('pays', pay);
  return socClean_(pay);
}
// Deshace el ÚLTIMO pago de un socio (para corregir un error)
function socUndoPay_(id) {
  var pays = socRead_('pays'), pay = pays.filter(function (x) { return x.id === id; })[0];
  if (!pay) throw new Error('No encontré ese pago.');
  var later = pays.some(function (x) { return x.partnerId === pay.partnerId && String(x.createdAt) > String(pay.createdAt); });
  if (later) throw new Error('Solo se puede deshacer el último pago de este socio.');
  if (socRead_('referrals').some(function (r) { return r.payId === id && r.status === 'chargedback'; }))
    throw new Error('Una de esas ventas ya tiene chargeback: corrige eso primero.');
  socRead_('referrals').forEach(function (r) {
    if (r.payId === id) { r.status = 'pending'; r.paidDate = ''; r.payId = ''; socSave_('referrals', r); }
    if (r.cbPayId === id) { r.chargebackDeducted = 'false'; r.cbPayId = ''; socSave_('referrals', r); }
  });
  var p = socRead_('partners').filter(function (x) { return x.id === pay.partnerId; })[0];
  if (p) { p.pendingDebt = socNum_(pay.prevDebt); socSave_('partners', p); }
  socDelete_('pays', pay);
}

// ─── Ligar una activación (📡 Activaciones) con un socio ─────────────
function socPkgFromAct_(a) {
  var parts = [];
  if (String(a.InternetTier || '').trim()) parts.push('Internet ' + a.InternetTier);
  if (String(a.VideoTier || '').trim()) parts.push('TV');
  var n = +a.MobileLines || 0;
  if (!parts.length) return n ? 'Solo móvil (' + n + ' línea' + (n > 1 ? 's' : '') + ')' : 'Spectrum';
  if (n) parts.push(n + ' línea' + (n > 1 ? 's' : '') + ' (no se pagan)');
  return parts.join(' + ');
}
function socTitle_(s) { return String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); }); }
function socLink_(d) {
  var actId = String(d.actId || ''), pid = String(d.partnerId || '');
  var a = socActs_(0).filter(function (x) { return x.ID === actId; })[0];
  if (!a) throw new Error('No encontré esa activación.');
  var R = socRead_('referrals');
  var r = R.filter(function (x) { return x.actId === actId; })[0];
  if (!pid) {                                            // quitar el socio de la activación
    if (!r) return '';
    if (r.status === 'paid' || r.status === 'chargedback') throw new Error('Ya se le pagó al socio por esta venta: no se puede quitar.');
    if (r.source === 'activacion') { socDelete_('referrals', r); return ''; }
    r.actId = ''; r.status = 'lead'; r.saleDate = ''; r.updatedAt = socNowIso_(); socSave_('referrals', r);
    return r.id;
  }
  if (!socRead_('partners').some(function (p) { return p.id === pid; })) throw new Error('Escoge el socio.');
  if (r && r.partnerId !== pid && (r.status === 'paid' || r.status === 'chargedback'))
    throw new Error('Ya se le pagó a otro socio por esta venta.');
  if (!r && d.refId) {                                    // se escogió el referido a mano en 🤝 Socios
    r = R.filter(function (x) { return x.id === String(d.refId); })[0];
    if (!r) throw new Error('No encontré ese referido.');
    if (r.actId && r.actId !== actId) throw new Error('Ese referido ya está ligado a otra activación.');
    if (r.partnerId !== pid && (r.status === 'paid' || r.status === 'chargedback')) throw new Error('Ese referido ya se le pagó a otro socio.');
  }
  if (!r) {                                               // ¿ya estaba como lead de ese socio?
    var ph = socDigits_(a.Phone), acct = String(a.AccountNumber || '').replace(/\D/g, ''), nm = socNorm_(a.CustomerName);
    r = R.filter(function (x) {
      if (x.partnerId !== pid || x.actId || (x.status !== 'lead' && x.status !== 'pending')) return false;
      if (ph.length === 10 && socDigits_(x.phone) === ph) return true;
      if (acct && String(x.account || '').replace(/\D/g, '') === acct) return true;
      var xn = socNorm_(x.name);
      return nm.length > 1 && xn.length > 1 && xn[0] === nm[0] && xn[xn.length - 1] === nm[nm.length - 1];
    }).sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); })[0];
  }
  if (!r) r = { id: socNewId_(), createdAt: socNowIso_(), source: 'activacion', name: socTitle_(a.CustomerName), notes: '' };
  if (r.status === 'paid' || r.status === 'chargedback') {   // ya pagado: solo se liga, no se cambia nada de dinero
    r.actId = actId; r.account = String(a.AccountNumber || '').replace(/\D/g, ''); r.updatedAt = socNowIso_();
    socSave_('referrals', r);
    return r.id;
  }
  r.partnerId = pid;
  r.actId = actId;
  r.account = String(a.AccountNumber || '').replace(/\D/g, '');
  if (!r.name) r.name = socTitle_(a.CustomerName);
  if (!r.phone && a.Phone) r.phone = a.Phone;
  r.carrier = 'Spectrum';
  r.package = socPkgFromAct_(a);
  r.saleDate = a.OrderDate;
  if (r.status !== 'pending') r.status = 'pending';
  r.updatedAt = socNowIso_();
  socSave_('referrals', r);
  return r.id;
}
