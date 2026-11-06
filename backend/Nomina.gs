/**
 * Nomina.gs — 💵 Nómina de asesoras y 💵 Mi pago (MirComm App, Palmhurst)
 *
 * INSTALACIÓN (una sola vez):
 *  1. Apps Script → ＋ (Archivo nuevo) → Script → nómbralo "Nomina" y pega este archivo completo. Guarda.
 *  2. En Code.gs, dentro de doGet(e) Y dentro de doPost(e), justo DEBAJO de esta línea:
 *         var gate = authGate_(e); if (gate) return gate;
 *     pega esta otra:
 *         var nom = nominaRouter_(e); if (nom) return nom;
 *     (Tiene que ir antes de los demás routers.)
 *  3. Deploy → Manage deployments → ✏️ → Version: New version → Deploy. (NUNCA "New deployment".)
 *  4. El lunes 12 oct en la mañana (antes de que Lizbeth entre): en el menú de funciones de arriba escoge
 *     corregirVentasDeAlondra y dale ▶ Run. Pone "Hecha por: Alondra" en las ventas hechas con los Rep IDs
 *     de Lizbeth entre el 1 jun y el 11 oct 2026. Se puede correr las veces que quieras (no duplica nada).
 *
 * VENTAS DE MÁS DE 7 DÍAS (líneas por registrar): en Activaciones.gs busca (Ctrl+F) esta línea:
 *     if (actDayDiff_(date, today) > 7) throw
 *   y cámbiala por:
 *     if (actDayDiff_(date, today) > 7 && !cajaVentaValida_(me, d)) throw
 *   (lo demás de esa línea se queda igual). Así la asesora puede registrar una venta vieja SOLO si viene de una
 *   venta suya en caja y con la fecha de esa venta; para todo lo demás sigue el límite de 7 días.
 *
 * Caja (POS): líneas por registrar, reimprimir recibos y oferta de accesorio (hojas nuevas Caja_SinLinea y
 * Caja_Accesorios, se crean solas). Las asesoras usan estas acciones con su PIN; Joel con su sesión de manager.
 *
 * Mi pago: las asesoras NO lo ven mientras "Puede ver Mi pago" esté apagado en ⚙ Plan (lo revisa este archivo,
 * no solo la app). Joel lo ve desde 💵 Nómina → 👁 Ver como.
 *
 * No cambia ninguna hoja que ya existe. Crea solas: Nomina_Cellmart, Nomina_Horas y Nomina_Pagos.
 *
 * Acciones:
 *  - actRepPay       (asesora, con su PIN)  → sus ventas, estado de Cellmart, horas y pagos.
 *  - nomGet          (manager)              → todo para armar la nómina.
 *  - nomSaveStatus   (manager, POST)        → guarda lo que dicen los reportes de Cellmart.
 *  - nomSaveHours    (manager)              → horas de una asesora en un periodo.
 *  - nomSaveConfig   (manager, POST)        → tarifas del plan y datos de cada asesora.
 *  - nomClose        (manager, POST)        → cierra la nómina de una asesora (ya no se vuelve a pagar lo mismo).
 *  - nomReopen       (manager)              → borra un cierre para corregirlo.
 * La sesión del manager la revisa authGate_. Las acciones actRep* las revisa el PIN de la asesora (prosAuth_).
 */

var NOM_SHEETS = {
  dismiss: { name: 'Caja_SinLinea', headers: ['SaleID', 'Motivo', 'Por', 'Fecha'] },
  offers:  { name: 'Caja_Accesorios', headers: ['Fecha', 'SaleID', 'Asesora', 'Telefonos', 'Resultado', 'Razon', 'Accesorios'] },
  status: { name: 'Nomina_Cellmart', headers: ['ID', 'FiscalMonth', 'Asesora', 'CoreCode', 'ConnDate', 'InternetOK', 'Psus',
    'ComCode', 'PaidAmt', 'PayDate', 'ChargeAmt', 'ChargeDate', 'Nota', 'UpdatedAt'] },
  hours:  { name: 'Nomina_Horas', headers: ['Inicio', 'Fin', 'Asesora', 'Horas', 'UpdatedAt'] },
  pays:   { name: 'Nomina_Pagos', headers: ['ID', 'Inicio', 'Fin', 'Asesora', 'Horas', 'Base', 'Comisiones', 'Descuentos', 'Bonos',
    'Garantia', 'Ajuste', 'Total', 'Items', 'Nota', 'CerradoEl'] }
};

// Plan de la propuesta de Lizbeth (oct 2026). Se cambia desde la app (⚙ Plan) sin tocar código.
// mode: 'plan' = cobra comisiones · 'sim' = solo simulación para Joel (no se cierra nómina) · 'off' = no aparece
// bonusFrom: primer mes fiscal (AAAA-MM, del 29 al 28) en que cuentan los bonos de 8/12 internets y de equipo
// payroll.weekStart: día en que empieza la semana de pago (0 = domingo … 6 = sábado). Se paga cada sábado.
var NOM_DEFAULT_CONFIG = {
  rates: { intOwn: 75, intStore: 40, line: 15, tv: 10, bonus8: 100, bonus12: 250, bonusTeam: 100, teamGoal: 50,
           tier1: 8, tier2: 12, chargebackDays: 90 },
  payroll: { weekStart: 0, payDay: 6 },
  reps: {
    Lizbeth: { mode: 'plan', canView: false, hourly: 10, start: '2026-10-12', bonusFrom: '2026-11',
               guarantee: true, guaranteeRate: 13, guaranteeDays: 60 },
    Alondra: { mode: 'sim', canView: false, hourly: 10, start: '2026-09-29', bonusFrom: '2026-10',
               guarantee: false, guaranteeRate: 13, guaranteeDays: 60 }
  }
};
// Rep IDs que otra persona usó por un tiempo: dentro de [from, to] la venta es de `name`.
// Lizbeth estuvo fuera; Alondra vendió con sus IDs hasta el domingo 11 oct 2026.
var NOM_REP_HANDOVER = [
  { owner: 'Lizbeth', ids: ['CMMLB4896', 'CMMLB4898'], from: '2026-06-01', to: '2026-10-11', name: 'Alondra' }
];

var NOM_REP_ACTIONS = { actRepPay: 1, actRepPending: 1, actRepReceipts: 1, actRepDismissLine: 1, actRepOffer: 1 };
var NOM_MGR_ACTIONS = { nomGet: 1, nomSaveStatus: 1, nomSaveHours: 1, nomSaveConfig: 1, nomClose: 1, nomReopen: 1,
  posPending: 1, posRecent: 1, posDismissLine: 1, posOffer: 1, posOffers: 1 };

function nominaRouter_(e) {
  var p = {};
  var src = (e && e.parameter) || {};
  for (var k in src) p[k] = src[k];
  if (e && e.postData && e.postData.contents) {
    try { var b = JSON.parse(e.postData.contents); for (var j in b) p[j] = b[j]; } catch (err) {}
  }
  var a = String(p.action || '');
  if (!NOM_REP_ACTIONS[a] && !NOM_MGR_ACTIONS[a]) return null;
  var out;
  try {
    if (a === 'actRepPay') {
      var me = prosAuth_(p);                         // valida usuario + PIN de 6 dígitos (Prospectos.gs)
      var rc = nomConfig_().reps[me.name] || {};
      var can = !!rc.canView && rc.mode === 'plan';
      if (p.check) out = { ok: true, canView: can };
      else if (!can) throw new Error('Mi pago todavía no está disponible.');
      else out = nomData_(me.name);
    } else if (a === 'actRepPending') out = cajaPending_(prosAuth_(p).name);
    else if (a === 'actRepReceipts') { prosAuth_(p); out = cajaRecent_(30); }
    else if (a === 'actRepDismissLine') { var me2 = prosAuth_(p); out = cajaDismiss_(p.saleId, p.reason, me2.name, false); }
    else if (a === 'actRepOffer') { var me3 = prosAuth_(p); out = cajaOffer_(nomJson_(p.data), me3.name); }
    else if (a === 'posPending') out = cajaPending_('');
    else if (a === 'posRecent') out = cajaRecent_(+p.days || 45);
    else if (a === 'posDismissLine') out = cajaDismiss_(p.saleId, p.reason, 'Joel', true);
    else if (a === 'posOffer') out = cajaOffer_(nomJson_(p.data), '');
    else if (a === 'posOffers') out = cajaOffers_(p.start, p.end);
    else if (a === 'nomGet') out = nomData_('');
    else if (a === 'nomSaveStatus') out = nomSaveStatus_(nomJson_(p.data), nomJson_(p.team));
    else if (a === 'nomSaveHours') out = nomSaveHours_(p);
    else if (a === 'nomSaveConfig') out = nomSaveConfig_(nomJson_(p.config));
    else if (a === 'nomClose') out = nomClose_(nomJson_(p.data));
    else if (a === 'nomReopen') out = nomReopen_(String(p.id || ''));
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ─── Helpers ──────────────────────────────────────────────────────────
function nomJson_(v) {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}
function nomSS_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function nomTz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }
function nomIsDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function nomYmd_(v) {
  if (nomIsDate_(v)) return Utilities.formatDate(v, nomTz_(), 'yyyy-MM-dd');
  var s = String(v === undefined || v === null ? '' : v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return s;
}
function nomNow_() { return Utilities.formatDate(new Date(), nomTz_(), 'yyyy-MM-dd HH:mm'); }
function nomSheet_(key) {
  var def = NOM_SHEETS[key], ss = nomSS_();
  var sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
      .setBackground('#0A1F3C').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');   // fechas como texto
  }
  return sh;
}
function nomRows_(sh, keepDates) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  var v = sh.getRange(1, 1, lr, lc).getValues(), h = v[0];
  return v.slice(1).map(function (r, i) {
    var o = { _row: i + 2 };
    h.forEach(function (k, c) { if (k) o[k] = nomIsDate_(r[c]) && !keepDates ? nomYmd_(r[c]) : r[c]; });
    return o;
  });
}
function nomReadOpt_(name, keepDates) {
  var sh = nomSS_().getSheetByName(name);
  return sh ? nomRows_(sh, keepDates) : [];
}
function nomConfig_() {
  var raw = PropertiesService.getScriptProperties().getProperty('NOMINA_CONFIG');
  var c = raw ? JSON.parse(raw) : {};
  var d = JSON.parse(JSON.stringify(NOM_DEFAULT_CONFIG));
  var rates = c.rates || {}; for (var k in rates) d.rates[k] = rates[k];
  var pay = c.payroll || {}; for (var q in pay) d.payroll[q] = pay[q];
  var reps = c.reps || {};
  for (var n in reps) {
    d.reps[n] = d.reps[n] || {};
    for (var x in reps[n]) d.reps[n][x] = reps[n][x];
    if (!d.reps[n].mode) d.reps[n].mode = d.reps[n].active === false ? 'off' : 'plan';   // versión anterior
    delete d.reps[n].active;
  }
  return d;
}
function nomTeam_() {
  var raw = PropertiesService.getScriptProperties().getProperty('NOMINA_TEAM');
  return raw ? JSON.parse(raw) : {};
}
// Rep ID → nombre (de configurarProspectos), para ventas sin "Hecha por"
function nomRepMap_() {
  var map = { CMMCL4423: 'Joel' };
  try {
    if (typeof prosConfig_ === 'function') {
      var u = (prosConfig_() || {}).usuarios || {};
      for (var n in u) (u[n].repIds || []).forEach(function (id) { map[String(id).toUpperCase()] = n; });
    }
  } catch (err) {}
  return map;
}
function nomRepOf_(a, repMap) {
  var who = String(a.SoldBy || '').trim() || String(a.Employee || '').trim() || repMap[String(a.RepID || '').toUpperCase()] || '';
  return nomHandover_(who, a.RepID, nomYmd_(a.OrderDate));
}
// Lo vendido con el Rep ID (o a nombre) de otra persona mientras ella no estaba
function nomHandover_(who, repId, ymd) {
  var id = String(repId || '').toUpperCase();
  for (var i = 0; i < NOM_REP_HANDOVER.length; i++) {
    var h = NOM_REP_HANDOVER[i];
    if (ymd >= h.from && ymd <= h.to && (who === h.owner || (!who && h.ids.indexOf(id) >= 0))) return h.name;
  }
  return who;
}

/**
 * ▶ Correr una vez el lunes 12 oct (y cuando quieras, no duplica): pone SoldBy = Alondra en las ventas
 * de la hoja Activations que quedaron a nombre de Lizbeth entre el 1 jun y el 11 oct 2026.
 * Así 📱 Mis líneas, 📡 Activaciones y la nómina se las cuentan a Alondra.
 */
function corregirVentasDeAlondra() {
  var sh = nomSS_().getSheetByName('Activations');
  if (!sh) throw new Error('No encontré la hoja Activations.');
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2) { Logger.log('No hay ventas.'); return 0; }
  var v = sh.getRange(1, 1, lr, lc).getValues(), H = v[0];
  var c = {}; H.forEach(function (h, i) { c[h] = i; });
  if (c.SoldBy === undefined || c.OrderDate === undefined || c.RepID === undefined) throw new Error('Faltan columnas SoldBy/OrderDate/RepID en Activations.');
  var repMap = nomRepMap_(), n = 0;
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    var a = { SoldBy: row[c.SoldBy], Employee: c.Employee !== undefined ? row[c.Employee] : '', RepID: row[c.RepID], OrderDate: row[c.OrderDate] };
    if (nomRepOf_(a, repMap) === 'Alondra' && String(a.SoldBy || '').trim() !== 'Alondra') {
      sh.getRange(r + 1, c.SoldBy + 1).setValue('Alondra');
      n++;
    }
  }
  Logger.log(n + ' venta(s) quedaron con Hecha por: Alondra.');
  return n;
}

// ─── Lectura ──────────────────────────────────────────────────────────
var NOM_ACT_FIELDS = ['ID', 'OrderDate', 'AccountNumber', 'CustomerName', 'InternetTier', 'MobileLines', 'VideoTier', 'Voice',
  'MobileType', 'SoldBy', 'Employee', 'RepID', 'CreatedAt'];

function nomData_(onlyRep) {
  var repMap = nomRepMap_();
  var acts = nomReadOpt_('Activations').map(function (a) {
    var o = {};
    NOM_ACT_FIELDS.forEach(function (k) { o[k] = a[k] === undefined ? '' : a[k]; });
    o.OrderDate = nomYmd_(o.OrderDate);
    o.AccountNumber = String(o.AccountNumber).replace(/\D/g, '');
    o.Rep = nomRepOf_(a, repMap);
    return o;
  }).filter(function (a) { return a.ID && (!onlyRep || a.Rep === onlyRep); });
  var ids = {}; acts.forEach(function (a) { ids[a.ID] = 1; });

  var status = {}, updated = '';
  nomReadOpt_(NOM_SHEETS.status.name).forEach(function (s) {
    if (!ids[s.ID]) return;
    delete s._row; status[s.ID] = s;
    if (String(s.UpdatedAt) > updated) updated = String(s.UpdatedAt);
  });

  // Ventas propias: prospectos vendidos y atribuidos a la asesora
  var own = nomReadOpt_('Prospectos').filter(function (x) {
    return x.Estado === 'Vendido' && x.CuentaSpectrum && (!onlyRep || x.Asesora === onlyRep);
  }).map(function (x) {
    return { rep: x.Asesora, acct: String(x.CuentaSpectrum).replace(/\D/g, ''), attr: String(x.Atribucion || ''),
             name: String(x.Nombre || ''), date: nomYmd_(x.FechaVenta) };
  });

  var hours = nomReadOpt_(NOM_SHEETS.hours.name).filter(function (h) { return !onlyRep || h.Asesora === onlyRep; })
    .map(function (h) { return { start: nomYmd_(h.Inicio), end: nomYmd_(h.Fin), rep: h.Asesora, hours: +h.Horas || 0 }; });

  var pays = nomReadOpt_(NOM_SHEETS.pays.name).filter(function (r) { return !onlyRep || r.Asesora === onlyRep; })
    .map(function (r) {
      var items = []; try { items = JSON.parse(r.Items || '[]'); } catch (err) {}
      return { id: r.ID, start: nomYmd_(r.Inicio), end: nomYmd_(r.Fin), rep: r.Asesora, hours: +r.Horas || 0, base: +r.Base || 0,
               commissions: +r.Comisiones || 0, deductions: +r.Descuentos || 0, bonuses: +r.Bonos || 0,
               guarantee: +r.Garantia || 0, adjust: +r.Ajuste || 0, total: +r.Total || 0, items: items,
               note: String(r.Nota || ''), closedAt: String(r.CerradoEl || '') };
    });

  var config = nomConfig_();
  if (onlyRep) {
    var mine = {}; mine[onlyRep] = config.reps[onlyRep] || { active: false };
    config = { rates: config.rates, payroll: config.payroll, reps: mine };
  }
  return { ok: true, me: onlyRep || '', today: Utilities.formatDate(new Date(), nomTz_(), 'yyyy-MM-dd'),
           acts: acts, status: status, statusUpdated: updated, own: own, hours: hours, pays: pays,
           team: nomTeam_(), config: config };
}

// ─── Escritura (solo manager) ─────────────────────────────────────────
var NOM_COM_FINAL = { paid: 1, nocalc: 1, over: 1, under: 1 };

function nomSaveStatus_(list, team) {
  if (!list || !list.length) list = [];
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = nomSheet_('status'), H = NOM_SHEETS.status.headers;
    var rows = nomRows_(sh), byId = {};
    rows.forEach(function (r) { byId[r.ID] = r; });
    var now = nomNow_(), add = [], changed = 0;
    list.forEach(function (n) {
      if (!n || !n.ID) return;
      var cur = byId[n.ID], o = cur ? cur : {};
      var upd = false;
      function set(k, v) { if (v === undefined || v === null) return; if (String(o[k] === undefined ? '' : o[k]) !== String(v)) { o[k] = v; upd = true; } }
      set('FiscalMonth', n.FiscalMonth); set('Asesora', n.Asesora);
      // Core/Mobile: "fuera del rango" o "muy reciente" no borran lo que ya se sabía
      if (n.CoreCode && n.CoreCode !== 'out' && n.CoreCode !== 'recent') {
        set('CoreCode', n.CoreCode); set('ConnDate', n.ConnDate); set('InternetOK', n.InternetOK); set('Psus', n.Psus);
      }
      // Commission: un pago o chargeback ya visto no regresa a "en plazo"
      if (n.ComCode && n.ComCode !== 'out') {
        var prev = String(o.ComCode || '');
        var down = (NOM_COM_FINAL[prev] || prev === 'charged') && !NOM_COM_FINAL[n.ComCode] && n.ComCode !== 'charged';
        if (!down) {
          set('ComCode', n.ComCode); set('PaidAmt', n.PaidAmt); set('PayDate', n.PayDate);
          if (n.ComCode === 'charged') { set('ChargeAmt', n.ChargeAmt); set('ChargeDate', n.ChargeDate); }
        }
      }
      if (n.Nota !== undefined) set('Nota', n.Nota);
      if (!upd) return;
      o.UpdatedAt = now; changed++;
      if (cur) {
        sh.getRange(cur._row, 1, 1, H.length).setValues([H.map(function (k) { return o[k] === undefined ? '' : String(o[k]); })]);
      } else {
        o.ID = n.ID; add.push(H.map(function (k) { return o[k] === undefined ? '' : String(o[k]); })); byId[n.ID] = o;
      }
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, H.length).setNumberFormat('@').setValues(add);
    if (team && typeof team === 'object') {
      var t = nomTeam_();
      for (var fm in team) {        // { core, coreHasMob, mob, upd } — cada reporte actualiza solo su parte
        t[fm] = t[fm] || {};
        for (var tk in team[fm]) t[fm][tk] = team[fm][tk];
      }
      PropertiesService.getScriptProperties().setProperty('NOMINA_TEAM', JSON.stringify(t));
    }
    return { ok: true, changed: changed };
  } finally { lock.releaseLock(); }
}

function nomSaveHours_(p) {
  var start = nomYmd_(p.start), end = nomYmd_(p.end), rep = String(p.rep || '').trim(), h = Number(p.hours);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !rep) throw new Error('Faltan fechas o asesora.');
  if (!isFinite(h) || h < 0 || h > 200) throw new Error('Horas no válidas.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = nomSheet_('hours');
    var row = nomRows_(sh).filter(function (r) { return nomYmd_(r.Inicio) === start && nomYmd_(r.Fin) === end && r.Asesora === rep; })[0];
    var vals = [[start, end, rep, String(h), nomNow_()]];
    if (row) sh.getRange(row._row, 1, 1, 5).setValues(vals);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setNumberFormat('@').setValues(vals);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function nomSaveConfig_(c) {
  if (!c || typeof c !== 'object') throw new Error('Configuración vacía.');
  PropertiesService.getScriptProperties().setProperty('NOMINA_CONFIG', JSON.stringify({ rates: c.rates || {}, payroll: c.payroll || {}, reps: c.reps || {} }));
  return { ok: true, config: nomConfig_() };
}

function nomClose_(d) {
  if (!d || !d.rep || !d.start || !d.end) throw new Error('Faltan datos de la nómina.');
  if ((nomConfig_().reps[d.rep] || {}).mode !== 'plan') throw new Error(d.rep + ' no está en el plan de comisiones (solo simulación).');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = nomSheet_('pays');
    var taken = {};
    nomRows_(sh).forEach(function (r) {
      if (r.Asesora !== d.rep) return;
      try { JSON.parse(r.Items || '[]').forEach(function (it) { taken[it.key] = nomYmd_(r.Inicio) + ' al ' + nomYmd_(r.Fin); }); } catch (err) {}
    });
    var items = (d.items || []).map(function (it) { return { key: String(it.key), label: String(it.label || ''), amt: Number(it.amt) || 0 }; });
    var dup = items.filter(function (it) { return taken[it.key]; });
    if (dup.length) throw new Error('Ya se pagó en otra nómina: ' + dup.map(function (it) { return it.label + ' (' + taken[it.key] + ')'; }).join('; '));
    var id = 'N' + new Date().getTime();
    var row = [id, nomYmd_(d.start), nomYmd_(d.end), d.rep, String(+d.hours || 0), String(+d.base || 0), String(+d.commissions || 0),
      String(+d.deductions || 0), String(+d.bonuses || 0), String(+d.guarantee || 0), String(+d.adjust || 0), String(+d.total || 0),
      JSON.stringify(items), String(d.note || ''), nomNow_()];
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}

function nomReopen_(id) {
  if (!id) throw new Error('Falta el ID.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = nomSheet_('pays');
    var r = nomRows_(sh).filter(function (x) { return String(x.ID) === id; })[0];
    if (!r) throw new Error('No encontré esa nómina.');
    sh.deleteRow(r._row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}


// ═══ CAJA (POS) ═══════════════════════════════════════════════════════
var CAJA_SALES_SHEET = 'Sales_Palmhurst';
function cajaIsPhone_(c) { return /^(phones?|tel[eé]fonos?|celular(es)?|cell ?phones?)$/i.test(String(c || '').trim()); }
function cajaDateTime_(v) {
  if (nomIsDate_(v)) return Utilities.formatDate(v, nomTz_(), 'yyyy-MM-dd HH:mm');
  var s = String(v || '').trim();
  var d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, nomTz_(), 'yyyy-MM-dd HH:mm');
}
function cajaSales_(days) {
  var since = Utilities.formatDate(new Date(new Date().getTime() - days * 86400000), nomTz_(), 'yyyy-MM-dd');
  return nomReadOpt_(CAJA_SALES_SHEET, true).map(function (r) {   // con hora
    var items = []; try { items = JSON.parse(r.ItemsJSON || '[]'); } catch (err) {}
    return { SaleID: String(r.SaleID || ''), Date: cajaDateTime_(r.Date), Status: String(r.Status || ''), Employee: String(r.Employee || ''),
      Payment: String(r.Payment || ''), Items: items, Subtotal: +r.Subtotal || 0, DiscountAmount: +r.DiscountAmount || 0,
      DiscountDesc: String(r.DiscountDesc || ''), Tax: +r.Tax || 0, Total: +r.Total || 0,
      CustomerName: String(r.CustomerName || ''), CustomerPhone: String(r.CustomerPhone || ''),
      SpectrumAccountName: String(r.SpectrumAccountName || ''), SpectrumAccountNumber: String(r.SpectrumAccountNumber || '').replace(/\D/g, '') };
  }).filter(function (x) { return x.SaleID && x.Date.slice(0, 10) >= since; });
}
// Recibos de los últimos días (para reimprimir)
function cajaRecent_(days) {
  return { ok: true, sales: cajaSales_(days).sort(function (a, b) { return a.Date < b.Date ? 1 : -1; }) };
}
// Ventas con teléfono que todavía no tienen línea registrada (ni se marcó "no lleva línea")
function cajaPending_(onlyRep) {
  var acts = nomReadOpt_('Activations'), bySale = {}, imeis = {}, byAcct = {};
  acts.forEach(function (a) {
    if (a.PosSaleID) bySale[String(a.PosSaleID)] = 1;
    String(a.IMEIs || '').split(/[^\d]+/).forEach(function (x) { if (x.length >= 14) imeis[x] = 1; });
    var ac = String(a.AccountNumber || '').replace(/\D/g, '');
    if (ac && +a.MobileLines > 0 && !a.PosSaleID) (byAcct[ac] = byAcct[ac] || []).push(nomYmd_(a.OrderDate));
  });
  // Línea ya registrada en esa cuenta entre 1 día antes y 7 días después de la venta (registrada sin ligar a la venta)
  var acctDone = function (s) {
    var d0 = s.Date.slice(0, 10);
    return (byAcct[s.SpectrumAccountNumber] || []).some(function (d) { var k = cajaDayDiff_(d0, d); return k >= -1 && k <= 7; });
  };
  var dismissed = {};
  nomReadOpt_(NOM_SHEETS.dismiss.name).forEach(function (d) { dismissed[String(d.SaleID)] = 1; });
  var out = [];
  cajaSales_(45).forEach(function (s) {
    if (/void/i.test(s.Status) || dismissed[s.SaleID] || bySale[s.SaleID]) return;
    if (onlyRep && s.Employee !== onlyRep) return;
    var phones = s.Items.filter(function (i) { return cajaIsPhone_(i.category); });
    if (!phones.length) return;
    if (phones.every(function (i) { return imeis[String(i.barcode || '')]; })) return;
    if (s.SpectrumAccountNumber && acctDone(s)) return;
    out.push({ SaleID: s.SaleID, Date: s.Date, Employee: s.Employee, CustomerName: s.CustomerName, CustomerPhone: s.CustomerPhone,
      AccountName: s.SpectrumAccountName, AccountNumber: s.SpectrumAccountNumber,
      Phones: phones.map(function (i) { return { name: i.name, imei: String(i.barcode || ''), gift: !!i.gift, qty: +i.qty || 1 }; }),
      gift: phones.some(function (i) { return i.gift; }) });
  });
  out.sort(function (a, b) { return a.Date < b.Date ? -1 : 1; });
  return { ok: true, now: Utilities.formatDate(new Date(), nomTz_(), 'yyyy-MM-dd HH:mm'), pending: out };
}
function cajaDismiss_(saleId, reason, by, isManager) {
  saleId = String(saleId || ''); reason = String(reason || '').trim();
  if (!saleId || !reason) throw new Error('Falta la venta o el motivo.');
  var sale = cajaSales_(45).filter(function (s) { return s.SaleID === saleId; })[0];
  if (!sale) throw new Error('No encontré esa venta.');
  if (!isManager) {
    if (sale.Employee !== by) throw new Error('Esa venta la cobró ' + sale.Employee + '.');
    if (sale.Items.some(function (i) { return cajaIsPhone_(i.category) && i.gift; }))
      throw new Error('Un teléfono regalado siempre lleva línea. Si no se hizo, avísale a Joel.');
  }
  var sh = nomSheet_('dismiss');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setNumberFormat('@').setValues([[saleId, reason, by, nomNow_()]]);
  return { ok: true };
}
function cajaOffer_(d, rep) {
  if (!d || !d.SaleID) throw new Error('Falta la venta.');
  var sh = nomSheet_('offers');
  var row = [nomNow_(), String(d.SaleID), rep || String(d.Asesora || ''), String(d.Telefonos || ''), String(d.Resultado || ''),
    String(d.Razon || ''), String(d.Accesorios || '')];
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return { ok: true };
}
function cajaOffers_(start, end) {
  start = nomYmd_(start || '2000-01-01'); end = nomYmd_(end || '2999-12-31');
  return { ok: true, offers: nomReadOpt_(NOM_SHEETS.offers.name).map(function (r) {
    return { Fecha: String(r.Fecha), SaleID: String(r.SaleID), Asesora: String(r.Asesora), Telefonos: String(r.Telefonos),
             Resultado: String(r.Resultado), Razon: String(r.Razon), Accesorios: String(r.Accesorios) };
  }).filter(function (o) { var d = o.Fecha.slice(0, 10); return d >= start && d <= end; }) };
}

function cajaDayDiff_(a, b) {   // días de a → b (yyyy-MM-dd)
  var p = function (x) { var m = String(x).split('-'); return Date.UTC(+m[0], +m[1] - 1, +m[2]); };
  return Math.round((p(b) - p(a)) / 86400000);
}
/**
 * La usa actRepSave_ (Activaciones.gs) para dejar registrar una línea de más de 7 días:
 * solo si viene de una venta en caja de esa misma asesora (últimos 45 días, no anulada, con teléfono)
 * y la fecha de la línea es la de la venta o hasta 3 días después.
 */
function cajaVentaValida_(me, d) {
  try {
    var id = String((d && d.PosSaleID) || '').trim();
    if (!id || !me) return false;
    var s = cajaSales_(45).filter(function (x) { return x.SaleID === id; })[0];
    if (!s || /void/i.test(s.Status) || s.Employee !== me.name) return false;
    if (!s.Items.some(function (i) { return cajaIsPhone_(i.category); })) return false;
    var k = cajaDayDiff_(s.Date.slice(0, 10), String(d.OrderDate || '').slice(0, 10));
    return k >= 0 && k <= 3;
  } catch (err) { return false; }
}
