/**
 * Activaciones.gs — Spectrum activations for MirComm (Palmhurst)
 * ------------------------------------------------------------------
 * Reads every "Sales Agent Order Confirmation" email Spectrum sends to
 * mircommllc@gmail.com and saves each order as one row in the
 * "Activations" tab of the inventory spreadsheet. Mobile orders (whose
 * emails don't carry useful data) are added by hand from the app.
 *
 * It also checks the MANAGER PIN. The PIN lives in Script Properties, not in
 * index.html, so it no longer shows up in the public source code on GitHub.
 * Every Activaciones action requires the manager session token.
 *
 * UPDATING FROM AN EARLIER VERSION: replace this whole file, Save, then Deploy → Manage deployments → ✏️ → New version.
 * You do NOT need to run configurarPinManager again.
 *
 * LOGIN PROTECTION (whole app, including the POS):
 *  - Every person logs in with a PIN (Joel: manager PIN; asesoras: their 6-digit PIN from configurarProspectos)
 *    and gets a session token that the app sends on every call.
 *  - authGate_(e) checks that token. It must be the FIRST line of doGet(e) AND doPost(e) in Code.gs:
 *        var gate = authGate_(e); if (gate) return gate;
 *  - It does nothing until you run activarProteccion (so you can install and test first).
 *    If something breaks, run desactivarProteccion and the app works like before.
 *
 * SETUP (one time):
 *  1. In Apps Script: + (Add file) → Script → name it "Activaciones" → paste this whole file → Save.
 *  2. In Code.gs, inside doGet(e), right under the line
 *        var pr = prospectosRouter_(e); if (pr) return pr;
 *     add this line:
 *        var ar = activacionesRouter_(e); if (ar) return ar;
 *  3. Change NUEVO_PIN_MANAGER below to a NEW 4-digit PIN (0828 was public on GitHub),
 *     select configurarPinManager → Run. Then put the quotes back to empty ('') and Save.
 *  4. Select importAllSpectrumOrders → Run. Google asks for permission to read Gmail → Allow.
 *     This loads every past confirmation email (may take a minute).
 *  5. Select createActivationImportTrigger → Run. New emails are imported every 15 minutes.
 *  6. Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *     (NOT "New deployment": that changes the URL.)
 */

// ─── Manager PIN ───────────────────────────────────────────────────
// Write the new PIN here only while you run configurarPinManager, then clear it.
var NUEVO_PIN_MANAGER = '';
var MGR_SESSION_SECONDS = 21600;   // 6 hours (CacheService maximum)
var MGR_MAX_FAILS = 5;             // wrong tries before a 15-minute lock

function configurarPinManager() {
  var pin = String(NUEVO_PIN_MANAGER || '').trim();
  if (!/^\d{4}$/.test(pin)) throw new Error('Escribe un PIN de 4 dígitos en NUEVO_PIN_MANAGER y vuelve a correr.');
  PropertiesService.getScriptProperties().setProperty('MANAGER_PIN', pin);
  CacheService.getScriptCache().remove('mgr_fails');
  Logger.log('PIN de manager guardado. Ahora borra el número de NUEVO_PIN_MANAGER (deja \'\') y guarda.');
}

function actManagerLogin_(pin) {
  var real = PropertiesService.getScriptProperties().getProperty('MANAGER_PIN');
  if (!real) throw new Error('Falta correr configurarPinManager en Apps Script.');
  var cache = CacheService.getScriptCache();
  var fails = +(cache.get('mgr_fails') || 0);
  if (fails >= MGR_MAX_FAILS) throw new Error('Demasiados intentos. Espera 15 minutos.');
  if (String(pin || '') !== real) {
    cache.put('mgr_fails', String(fails + 1), 900);
    return { ok: false };
  }
  cache.remove('mgr_fails');
  var token = Utilities.getUuid();
  cache.put('mgr_' + token, '1', MGR_SESSION_SECONDS);
  cache.put('ses_' + token, 'Joel', MGR_SESSION_SECONDS);
  return { ok: true, token: token };
}

/** Asesora login: same 6-digit PIN as Prospectos. Returns a session token for the whole app. */
function actRepLogin_(p) {
  var me = prosAuth_(p);   // throws "PIN incorrecto." / lockout after 5 tries
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('ses_' + token, me.name, MGR_SESSION_SECONDS);
  return { ok: true, token: token, user: { name: me.name, manager: !!me.manager, code: me.code || '' } };
}

// ─── Login protection for the whole web app ───────────────────────
// Actions an asesora's session may call (everything else needs the manager session).
var AUTH_REP_ACTIONS = { getStock: 1, recordSale: 1, getCustomer: 1 };
// Actions that check the PIN themselves.
var AUTH_OPEN_ACTIONS = { managerLogin: 1, repLogin: 1 };

function activarProteccion() {
  PropertiesService.getScriptProperties().setProperty('AUTH_MODE', 'on');
  Logger.log('Protección ACTIVADA: toda la app pide sesión con PIN.');
}
function desactivarProteccion() {
  PropertiesService.getScriptProperties().setProperty('AUTH_MODE', 'off');
  Logger.log('Protección desactivada: la app funciona sin revisar sesión (como antes).');
}
function authSession_(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var name = cache.get('ses_' + token);
  if (!name) return null;
  var mgr = cache.get('mgr_' + token) === '1';
  // sliding expiration: every call keeps the session alive another 6 hours
  cache.put('ses_' + token, name, MGR_SESSION_SECONDS);
  if (mgr) cache.put('mgr_' + token, '1', MGR_SESSION_SECONDS);
  return { name: name, manager: mgr };
}
/**
 * Call as the first line of doGet(e) and doPost(e) in Code.gs:
 *    var gate = authGate_(e); if (gate) return gate;
 * Returns null when the call may continue, or a JSON error response.
 */
function authGate_(e) {
  if (PropertiesService.getScriptProperties().getProperty('AUTH_MODE') !== 'on') return null;
  var p = (e && e.parameter) || {}, body = {};
  if (e && e.postData && e.postData.contents) { try { body = JSON.parse(e.postData.contents) || {}; } catch (err) { body = {}; } }
  var action = String(p.action || body.action || '');
  if (AUTH_OPEN_ACTIONS[action] || action.indexOf('pros') === 0 || action.indexOf('actRep') === 0) return null;
  var ses = authSession_(p.mt || body.mt);
  var deny = function (msg) {
    return ContentService.createTextOutput(JSON.stringify({ error: msg, code: 'AUTH' })).setMimeType(ContentService.MimeType.JSON);
  };
  if (!ses) return deny('Tu sesión venció. Entra otra vez con tu PIN.');
  if (ses.manager) return null;
  if (!AUTH_REP_ACTIONS[action]) return deny('Esta opción es solo para el manager.');
  if (action === 'recordSale' && body.employee && body.employee !== ses.name)
    return deny('La venta tiene que quedar a nombre de quien entró con su PIN (' + ses.name + ').');
  return null;
}

/** True if the token belongs to a manager session that hasn't expired. Usable from other .gs files. */
function isManagerToken_(token) {
  return !!token && CacheService.getScriptCache().get('mgr_' + token) === '1';
}

var ACT_SHEET_NAME = 'Activations';
var ACT_HEADERS = [
  'ID', 'OrderDate', 'FiscalMonth', 'Source', 'RepID', 'Employee',
  'AccountNumber', 'WorkOrder', 'Confirmation',
  'CustomerName', 'Address', 'City', 'State', 'Zip', 'Phone', 'Email',
  'Package', 'InternetTier', 'MobileLines', 'MobilePlan', 'VideoTier', 'Voice', 'XumoDevices',
  'InstallType', 'OrderTotal', 'Products', 'IMEIs', 'Notes', 'GmailMsgId', 'CreatedAt',
  'SoldBy', 'MobileType', 'MobileOrder', 'LinePhones', 'EnteredBy', 'PosSaleID'
];
// MobileType = type of the FIRST line of the order. The other lines of the same order are always incremental.
//   Primera            → first line MirComm sells on that account ($150)
//   Incremental        → MirComm already sold a line on that account before ($250)
//   AdicionalNoNuestra → the account already had a line, but not one of ours ($150)
var ACT_MOBILE_TYPES = ['Primera', 'Incremental', 'AdicionalNoNuestra'];
// Spectrum Sales Rep ID → employee. Add Alondra's ID here when you have it
// (and in ACT_REPS inside index.html).
// Rep IDs saved in configurarProspectos (Prospectos.gs) are added automatically,
// so Alondra's ID only needs to go there.
var ACT_REPS = {
  'CMMCL4423': 'Joel',
  'CMMLB4896': 'Lizbeth',
  'CMMLB4898': 'Lizbeth'
};
var ACT_REPS_CACHE_ = null;
function actRepMap_() {
  if (ACT_REPS_CACHE_) return ACT_REPS_CACHE_;
  var m = {};
  Object.keys(ACT_REPS).forEach(function (k) { m[k] = ACT_REPS[k]; });
  try {
    var cfg = prosConfig_();
    Object.keys(cfg.usuarios || {}).forEach(function (n) {
      (cfg.usuarios[n].repIds || []).forEach(function (id) { id = String(id).toUpperCase().trim(); if (id) m[id] = n; });
    });
  } catch (e) { /* Prospectos not configured: use ACT_REPS only */ }
  return (ACT_REPS_CACHE_ = m);
}
var ACT_MOBILE_EMAIL_SHEET = 'MobileEmails';
var ACT_MOBILE_EMAIL_HEADERS = ['MsgId', 'OrderNumber', 'FirstName', 'OrderDate', 'Ignored', 'CreatedAt'];
var ACT_MOBILE_GMAIL_QUERY = 'from:MyAccount@spectrumemails.com subject:"Agent Order Confirmation" -subject:"Sales Agent"';
var ACT_GMAIL_QUERY = 'from:MyAccount@spectrumemails.com subject:"Sales Agent Order Confirmation"';
var ACT_EDITABLE = ['OrderDate', 'RepID', 'Employee', 'AccountNumber', 'WorkOrder', 'Confirmation',
  'CustomerName', 'Address', 'City', 'State', 'Zip', 'Phone', 'Email', 'Package', 'InternetTier',
  'MobileLines', 'MobilePlan', 'VideoTier', 'Voice', 'XumoDevices', 'InstallType', 'OrderTotal', 'IMEIs', 'Notes',
  'SoldBy', 'MobileType', 'MobileOrder', 'LinePhones', 'PosSaleID'];

// ─── Router (called from doGet) ─────────────────────────────────────
function activacionesRouter_(e) {
  var p = (e && e.parameter) || {};
  var a = p.action || '';
  var actions = { managerLogin: 1, repLogin: 1, getActivations: 1, importActivations: 1, saveActivation: 1, deleteActivation: 1,
    getMobileEmails: 1, ignoreMobileEmail: 1, getRepMap: 1,
    actRepList: 1, actRepCheck: 1, actRepSave: 1, actRepDelete: 1 };
  if (!actions[a]) return null;
  var out;
  try {
    if (a === 'managerLogin') {
      out = actManagerLogin_(p.pin);
    } else if (a === 'repLogin') {
      out = actRepLogin_(p);
    } else if (a.indexOf('actRep') === 0) {
      // Asesoras: same 6-digit PIN as Prospectos (prosAuth_ lives in Prospectos.gs)
      var me = prosAuth_(p);
      if (a === 'actRepList') out = actRepList_(me);
      else if (a === 'actRepCheck') out = actAccountHistory_(p.cuenta, null);
      else if (a === 'actRepSave') out = actRepSave_(me, JSON.parse(p.data || '{}'), p.force === '1');
      else if (a === 'actRepDelete') out = actRepDelete_(me, p.id);
    } else if (!isManagerToken_(p.mt)) {
      out = { error: 'Tu sesión de manager venció. Dale ↩ Switch User y entra otra vez con tu PIN.' };
    } else if (a === 'getActivations') {
      out = actReadAll_(actSheet_()).rows.map(function (r) { delete r._row; return r; });
    } else if (a === 'importActivations') {
      out = p.all === '1' ? importAllSpectrumOrders() : importSpectrumOrders();
    } else if (a === 'saveActivation') {
      out = actSave_(JSON.parse(p.data || '{}'));
    } else if (a === 'deleteActivation') {
      out = actDelete_(p.id);
    } else if (a === 'getRepMap') {
      out = actRepMap_();
    } else if (a === 'getMobileEmails') {
      out = actMobileEmailsWithStatus_(actReadAll_(actSheet_()).rows);
    } else if (a === 'ignoreMobileEmail') {
      out = actIgnoreMobileEmail_(p.msgId, p.undo === '1');
    }
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ─── Gmail import ──────────────────────────────────────────────────
/** Trigger target: picks up confirmations from the last 10 days that aren't saved yet. */
function importSpectrumOrders() {
  var r = actImport_(ACT_GMAIL_QUERY + ' newer_than:10d', 200);
  try { r.mobileEmails = actImportMobileEmails_(ACT_MOBILE_GMAIL_QUERY + ' newer_than:10d', 200).added; }
  catch (err) { r.errors = (r.errors || []).concat(['Correos móviles: ' + err.message]); }
  return r;
}
/** Run once by hand to load the whole email history. Safe to re-run (skips duplicates). */
function importAllSpectrumOrders() {
  var r = actImport_(ACT_GMAIL_QUERY, 2000);
  r.mobileEmails = actImportMobileEmails_(ACT_MOBILE_GMAIL_QUERY, 2000).added;
  Logger.log('Imported ' + r.added + ' new activation(s) and ' + r.mobileEmails + ' mobile order email(s). Errors: ' + r.errors.length);
  return r;
}
/** Run once: imports new confirmation emails every 15 minutes. */
function createActivationImportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importSpectrumOrders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importSpectrumOrders').timeBased().everyMinutes(15).create();
  Logger.log('Trigger created: importSpectrumOrders every 15 minutes.');
}

function actImport_(query, max) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { added: 0, errors: [], busy: true };
  try {
    var sh = actSheet_();
    var data = actReadAll_(sh);
    var seenMsg = {}, seenConf = {};
    data.rows.forEach(function (r) {
      if (r.GmailMsgId) seenMsg[r.GmailMsgId] = 1;
      if (r.Confirmation) seenConf[r.Confirmation] = 1;
    });
    var tz = Session.getScriptTimeZone();
    var newRows = [], errors = [], start = 0, batch = 100, t0 = Date.now();
    while (start < max) {
      var threads = GmailApp.search(query, start, Math.min(batch, max - start));
      if (!threads.length) break;
      threads.forEach(function (th) {
        th.getMessages().forEach(function (msg) {
          var id = msg.getId();
          if (seenMsg[id]) return;
          if (!/Sales Agent Order Confirmation/i.test(msg.getSubject())) return;
          seenMsg[id] = 1;
          try {
            var o = actParseMessage_(msg, tz);
            if (o.Confirmation && seenConf[o.Confirmation]) return;
            if (o.Confirmation) seenConf[o.Confirmation] = 1;
            newRows.push(o);
          } catch (err) {
            errors.push(id + ': ' + err.message);
          }
        });
      });
      start += threads.length;
      if (threads.length < batch || Date.now() - t0 > 270000) break;
    }
    newRows.sort(function (a, b) { return a.OrderDate < b.OrderDate ? -1 : a.OrderDate > b.OrderDate ? 1 : 0; });
    if (newRows.length) {
      var vals = newRows.map(function (o) {
        return data.headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); });
      });
      sh.getRange(sh.getLastRow() + 1, 1, vals.length, data.headers.length).setNumberFormat('@').setValues(vals);
    }
    return { added: newRows.length, errors: errors };
  } finally {
    lock.releaseLock();
  }
}

// ─── "Agent Order Confirmation" (mobile-only orders) ──────────────
// These emails only carry the first name, the 14-digit mobile order number and the date.
// They are NOT activations: they are reminders. Each line must be registered by the asesora.
function actImportMobileEmails_(query, max) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { added: 0, busy: true };
  try {
    var sh = actMobileEmailSheet_();
    var seen = {};
    actReadAll_(sh).rows.forEach(function (r) { seen[r.MsgId] = 1; });
    var tz = Session.getScriptTimeZone(), out = [], start = 0, batch = 100;
    while (start < max) {
      var threads = GmailApp.search(query, start, Math.min(batch, max - start));
      if (!threads.length) break;
      threads.forEach(function (th) {
        th.getMessages().forEach(function (msg) {
          var id = msg.getId();
          if (seen[id] || !/^\s*Agent Order Confirmation\s*$/i.test(msg.getSubject())) return;
          seen[id] = 1;
          var o = actParseMobileEmail_(msg.getPlainBody() || msg.getBody());
          if (!o.OrderNumber) return;
          out.push([id, o.OrderNumber, o.FirstName, Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd'), '',
            Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss")]);
        });
      });
      start += threads.length;
      if (threads.length < batch) break;
    }
    if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, ACT_MOBILE_EMAIL_HEADERS.length).setNumberFormat('@').setValues(out);
    return { added: out.length };
  } finally {
    lock.releaseLock();
  }
}
/** Pure: "This is to confirm your Order #: 12386580567255 for JASMINE on October 5, 2026." */
function actParseMobileEmail_(text) {
  var t = actDecode_(String(text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  var m = t.match(/Order\s*#\s*:?\s*(\d{8,})\s+for\s+(.+?)\s+on\s+[A-Z][a-z]+\s+\d{1,2},\s*\d{4}/i);
  return m ? { OrderNumber: m[1], FirstName: m[2].trim() } : { OrderNumber: '', FirstName: '' };
}
function actMobileEmailSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(ACT_MOBILE_EMAIL_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ACT_MOBILE_EMAIL_SHEET);
    sh.getRange(1, 1, sh.getMaxRows(), ACT_MOBILE_EMAIL_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, ACT_MOBILE_EMAIL_HEADERS.length).setValues([ACT_MOBILE_EMAIL_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function actNameKey_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0] || '';
}
function actDayDiff_(a, b) {
  var da = new Date(String(a).slice(0, 10) + 'T00:00:00Z'), db = new Date(String(b).slice(0, 10) + 'T00:00:00Z');
  return Math.round(Math.abs(da - db) / 86400000);
}
/** Pure: links each email to a registered row (by order number, or by first name ±1 day). */
function actLinkMobileEmails_(emails, rows) {
  var byOrder = {};
  rows.forEach(function (r) { String(r.MobileOrder || '').split(/[^\d]+/).forEach(function (o) { if (o) byOrder[o] = r; }); });
  var used = {};
  return emails.map(function (e) {
    var o = { MsgId: e.MsgId, OrderNumber: e.OrderNumber, FirstName: e.FirstName, OrderDate: e.OrderDate,
      Ignored: e.Ignored || '', status: 'pending', matchId: '', matchBy: '' };
    var r = byOrder[e.OrderNumber];
    if (r) { o.status = 'registered'; o.matchId = r.ID; o.matchBy = 'orden'; used[r.ID] = 1; }
    else {
      var key = actNameKey_(e.FirstName);
      var cand = rows.filter(function (x) {
        return +x.MobileLines > 0 && !used[x.ID] && !x.MobileOrder && key &&
          actNameKey_(x.CustomerName) === key && actDayDiff_(x.OrderDate, e.OrderDate) <= 1;
      })[0] || rows.filter(function (x) {   // "LAST, FIRST" style names
        return +x.MobileLines > 0 && !used[x.ID] && !x.MobileOrder && key && actDayDiff_(x.OrderDate, e.OrderDate) <= 1 &&
          String(x.CustomerName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).indexOf(key) >= 0;
      })[0];
      if (cand) { o.status = 'registered'; o.matchId = cand.ID; o.matchBy = 'nombre'; used[cand.ID] = 1; }
      else if (o.Ignored) o.status = 'ignored';
    }
    return o;
  });
}
function actMobileEmailsWithStatus_(rows) {
  var emails = actReadAll_(actMobileEmailSheet_()).rows;
  return actLinkMobileEmails_(emails, rows).sort(function (a, b) { return a.OrderDate < b.OrderDate ? 1 : -1; });
}
function actIgnoreMobileEmail_(msgId, undo) {
  var sh = actMobileEmailSheet_(), data = actReadAll_(sh);
  var r = data.rows.filter(function (x) { return x.MsgId === msgId; })[0];
  if (!r) throw new Error('Correo no encontrado.');
  var c = data.headers.indexOf('Ignored') + 1;
  sh.getRange(r._row, c).setValue(undo ? '' : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  return { ok: true };
}

// ─── Asesoras: register their own mobile lines ───────────────────
/** MirComm's earlier mobile lines on an account (to decide Primera vs Incremental). Pure helper. */
function actPriorMobile_(rows, acct, beforeDate, excludeId) {
  return rows.filter(function (r) {
    return r.ID !== excludeId && String(r.AccountNumber || '').replace(/\D/g, '') === acct && +r.MobileLines > 0 &&
      (!beforeDate || String(r.OrderDate || '') <= beforeDate);
  }).sort(function (a, b) { return a.OrderDate < b.OrderDate ? -1 : 1; });
}
function actAccountHistory_(cuenta, rows) {
  var acct = String(cuenta || '').replace(/\D/g, '');
  if (acct.length < 9) return { ok: false, message: 'Escribe el número de cuenta completo.' };
  rows = rows || actReadAll_(actSheet_()).rows;
  var prior = actPriorMobile_(rows, acct, '', '');
  var all = rows.filter(function (r) { return String(r.AccountNumber || '').replace(/\D/g, '') === acct; });
  return {
    ok: true, account: acct,
    customerName: all.length ? all[all.length - 1].CustomerName : '',
    priorLines: prior.reduce(function (s, r) { return s + (+r.MobileLines || 0); }, 0),
    prior: prior.map(function (r) { return { date: r.OrderDate, lines: +r.MobileLines, by: r.SoldBy || r.Employee || actRepMap_()[String(r.RepID).toUpperCase()] || r.RepID || '' }; }),
    otherServices: all.filter(function (r) { return !(+r.MobileLines > 0); }).map(function (r) {
      return { date: r.OrderDate, internet: r.InternetTier || '', tv: r.VideoTier || '' };
    }),
    suggest: prior.length ? 'Incremental' : ''
  };
}
function actRepList_(me) {
  var rows = actReadAll_(actSheet_()).rows;
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var cur = actFiscalMonth_(today);
  var since = Utilities.formatDate(new Date(Date.now() - 70 * 86400000), tz, 'yyyy-MM-dd');
  var mine = rows.filter(function (r) {
    var who = r.SoldBy || r.Employee || actRepMap_()[String(r.RepID || '').toUpperCase()] || '';
    return who === me.name && +r.MobileLines > 0 && String(r.OrderDate) >= since;
  }).map(function (r) {
    return { ID: r.ID, OrderDate: r.OrderDate, FiscalMonth: r.FiscalMonth, CustomerName: r.CustomerName,
      AccountNumber: r.AccountNumber, MobileLines: r.MobileLines, MobileType: r.MobileType, MobilePlan: r.MobilePlan,
      MobileOrder: r.MobileOrder, LinePhones: r.LinePhones, RepID: r.RepID, Source: r.Source, EnteredBy: r.EnteredBy,
      CreatedAt: r.CreatedAt, canDelete: r.Source === 'Asesora' && r.EnteredBy === me.name && String(r.CreatedAt).slice(0, 10) === today };
  }).sort(function (a, b) { return a.OrderDate < b.OrderDate ? 1 : -1; });
  var weekAgo = Utilities.formatDate(new Date(Date.now() - 10 * 86400000), tz, 'yyyy-MM-dd');
  var emails = actMobileEmailsWithStatus_(rows).filter(function (e) { return e.status === 'pending' && e.OrderDate >= weekAgo; })
    .map(function (e) { return { MsgId: e.MsgId, OrderNumber: e.OrderNumber, FirstName: e.FirstName, OrderDate: e.OrderDate }; });
  var map = actRepMap_();
  var allReps = Object.keys(map).map(function (k) { return { id: k, name: map[k] }; });
  (me.repIds || []).forEach(function (k) { k = String(k).toUpperCase(); if (!map[k]) allReps.push({ id: k, name: me.name }); });
  return { ok: true, me: { name: me.name, repIds: (me.repIds || []).map(function (k) { return String(k).toUpperCase(); }) },
    today: today, fiscalMonth: cur, lines: mine, emails: emails, reps: allReps };
}
function actRepSave_(me, d, force) {
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var acct = String(d.AccountNumber || '').replace(/\D/g, '');
  var lines = Math.floor(+d.MobileLines || 0);
  var type = String(d.MobileType || '');
  var date = String(d.OrderDate || today).slice(0, 10);
  var order = String(d.MobileOrder || '').replace(/\D/g, '');
  if (acct.length < 9) throw new Error('Escribe el número de cuenta Spectrum completo.');
  if (!String(d.CustomerName || '').trim()) throw new Error('Escribe el nombre del cliente.');
  if (!(lines >= 1 && lines <= 10)) throw new Error('Líneas: escribe un número del 1 al 10.');
  if (ACT_MOBILE_TYPES.indexOf(type) < 0) throw new Error('Escoge si es primera línea, incremental o adicional.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new Error('La fecha no puede ser futura.');
  if (actDayDiff_(date, today) > 7 && !cajaVentaValida_(me, d)) throw new Error('Solo puedes registrar ventas de los últimos 7 días. Para algo más viejo, avísale a Joel.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var rows;
  try {
    rows = actReadAll_(actSheet_()).rows;
  } finally { lock.releaseLock(); }
  if (order && rows.some(function (r) { return String(r.MobileOrder || '').split(/[^\d]+/).indexOf(order) >= 0; }))
    throw new Error('Esa orden (' + order + ') ya está registrada.');
  var sameDay = rows.filter(function (r) {
    return String(r.AccountNumber || '').replace(/\D/g, '') === acct && +r.MobileLines > 0 && r.OrderDate === date;
  });
  if (sameDay.length && !force) {
    var who = sameDay[0].SoldBy || sameDay[0].Employee || sameDay[0].RepID;
    return { ok: false, confirm: 'Ya hay ' + sameDay[0].MobileLines + ' línea(s) registradas en esta cuenta con fecha ' + date +
      (who ? ' (' + who + ')' : '') + '. ¿Es otra orden distinta?' };
  }
  var prior = actPriorMobile_(rows, acct, date, '');
  var warning = '';
  if (prior.length && type !== 'Incremental') warning = 'Ya le habíamos hecho una línea a esta cuenta el ' + prior[prior.length - 1].OrderDate + '. Joel lo va a revisar.';
  if (!prior.length && type === 'Incremental') warning = 'No encontré una línea anterior nuestra en esta cuenta. Joel lo va a revisar.';
  var rep = String(d.RepID || (me.repIds || [])[0] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var rec = actSave_({
    OrderDate: date, RepID: rep, AccountNumber: acct, CustomerName: String(d.CustomerName).trim(),
    Phone: String(d.Phone || '').replace(/\D/g, ''), MobileLines: String(lines), MobilePlan: d.MobilePlan || '',
    MobileType: type, MobileOrder: order, LinePhones: String(d.LinePhones || '').trim(), IMEIs: String(d.IMEIs || '').trim(),
    Notes: String(d.Notes || '').trim(), SoldBy: me.name, PosSaleID: String(d.PosSaleID || '').trim()
  }, { Source: 'Asesora', EnteredBy: me.name });
  return { ok: true, line: rec, warning: warning };
}
function actRepDelete_(me, id) {
  var sh = actSheet_();
  var r = actReadAll_(sh).rows.filter(function (x) { return x.ID === id; })[0];
  if (!r) throw new Error('No encontré ese registro.');
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (r.Source !== 'Asesora' || r.EnteredBy !== me.name || String(r.CreatedAt).slice(0, 10) !== today)
    throw new Error('Solo puedes borrar lo que tú registraste hoy. Para corregir otra cosa, avísale a Joel.');
  sh.deleteRow(r._row);
  return { ok: true, deleted: id };
}

function actParseMessage_(msg, tz) {
  var o = actParseHtml_(msg.getBody());
  o.OrderDate = Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd');
  o.FiscalMonth = actFiscalMonth_(o.OrderDate);
  o.Source = 'Email';
  o.GmailMsgId = msg.getId();
  o.ID = 'E' + o.GmailMsgId;
  o.CreatedAt = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss");
  return o;
}

// ─── Parser (pure — no Apps Script calls) ───────────────────────────
function actParseHtml_(html) {
  html = String(html || '');
  var lines = actHtmlToLines_(html);
  var f = function (label) { return actField_(lines, label); };
  var addr = actSplitAddress_(f('Address'));
  var rep = f('Sales Rep ID').toUpperCase();
  var products = actProducts_(html, lines);
  var pk = actPackages_(html);
  var cls = actClassify_(products, pk.names.join(' + '));
  return {
    RepID: rep,
    Employee: (typeof actRepMap_ === 'function' ? actRepMap_() : ACT_REPS)[rep] || '',
    AccountNumber: f('Account Number').replace(/\D/g, ''),
    WorkOrder: f('Work Order Number').replace(/\D/g, ''),
    Confirmation: f('Confirmation Number').replace(/\D/g, ''),
    CustomerName: f('Customer Name'),
    Address: addr.street, City: addr.city, State: addr.state, Zip: addr.zip,
    Phone: f('Customer Phone').replace(/\D/g, '').slice(-10),
    Email: f('Customer Email'),
    Package: pk.names.join(' + '),
    InternetTier: cls.internetTier,
    MobileLines: cls.mobileLines || '',
    MobilePlan: cls.mobilePlan,
    VideoTier: cls.videoTier,
    Voice: cls.voice ? 'Yes' : '',
    XumoDevices: cls.xumo || '',
    InstallType: f('Installation Type'),
    OrderTotal: pk.total || '',
    Products: JSON.stringify(products)
  };
}

function actDecode_(s) {
  return String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
    .replace(/[‐-–]/g, '-')
    .replace(/[͏​-‍﻿]/g, '')
    .replace(/[\s ]+/g, ' ')
    .trim();
}
function actHtmlToLines_(html) {
  var s = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|tr|li)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  return s.split('\n').map(actDecode_).filter(function (l) { return l; });
}
function actField_(lines, label) {
  var re = new RegExp('^' + label.replace(/ /g, '\\s+') + '\\s*:\\s*(.*)$', 'i');
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(re);
    if (m) return m[1].replace(/\s*\|\s*$/, '').trim();
  }
  return '';
}
function actSplitAddress_(a) {
  var m = String(a || '').match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\s*$/);
  if (!m) return { street: a || '', city: '', state: '', zip: '' };
  return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] };
}
function actMoney_(s) {
  var m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? +m[0] : '';
}
function actProducts_(html, lines) {
  var out = [], m;
  var clean = String(html).replace(/<!--[\s\S]*?-->/g, '');
  var re = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/gi;
  while ((m = re.exec(clean))) {
    var name = actDecode_(m[1]);
    if (!name || /^product name$/i.test(name)) continue;
    out.push({ name: name, qty: +m[2] || 1, monthly: actMoney_(m[3]), once: actMoney_(m[4]) });
  }
  if (!out.length) { // fallback: "Name | 1 | $60.00 | |" lines
    (lines || []).forEach(function (l) {
      var x = l.match(/^(.+?) \| (\d+) \| ([^|]*)\|([^|]*)/);
      if (x && !/^product name$/i.test(x[1].trim())) {
        out.push({ name: x[1].trim(), qty: +x[2] || 1, monthly: actMoney_(x[3]), once: actMoney_(x[4]) });
      }
    });
  }
  return out;
}
function actPackages_(html) {
  var clean = String(html).replace(/<!--[\s\S]*?-->/g, '');
  var re = /<th[^>]*>\s*<b>([^<]+)<\/b>\s*<\/th>\s*<th[^>]*>\s*<b>\s*Order Total\s*-\s*\$?\s*([\d,.]+)/gi, m;
  var names = [], total = 0;
  while ((m = re.exec(clean))) {
    names.push(actDecode_(m[1]));
    total += +String(m[2]).replace(/,/g, '') || 0;
  }
  return { names: names, total: total ? total.toFixed(2) : '' };
}
function actClassify_(products, pkgText) {
  var r = { internetTier: '', mobileLines: 0, mobilePlan: '', videoTier: '', voice: false, xumo: 0 };
  products.forEach(function (p) {
    var n = p.name;
    if (/xumo/i.test(n)) { r.xumo += p.qty; return; }
    var mi = n.match(/^Spectrum Internet\b\s*(.*)$/i);
    if (mi && !/assist|wifi|modem|router|gateway|security/i.test(n)) { r.internetTier = mi[1].trim() || 'Internet'; return; }
    if (/\bLines?\b/i.test(n) && /(unlimited|by.the.gig|mobile)/i.test(n) && !/(activation|kit|insurance|protect|device|port)/i.test(n)) {
      var lead = n.match(/^(\d+)\s/);
      r.mobileLines += (lead ? +lead[1] : 1) * p.qty;
      var plan = /unlimited plus/i.test(n) ? 'Unlimited Plus' : /unlimited/i.test(n) ? 'Unlimited' : /by.the.gig/i.test(n) ? 'By the Gig' : '';
      if (plan && r.mobilePlan.indexOf(plan) < 0) r.mobilePlan = r.mobilePlan ? r.mobilePlan + ', ' + plan : plan;
      return;
    }
    if (/^Spectrum Voice\b|home phone/i.test(n)) { r.voice = true; return; }
    if (/^Spectrum\s+(Stream TV|TV|Latino|Select|Signature|VIP|Pro|Essentials|Choice|Lite|Mi Plan)/i.test(n) &&
        !/(kit|box|dvr|receiver|equipment)/i.test(n)) {
      r.videoTier = n.replace(/^Spectrum\s+/i, '').trim();
    }
  });
  // Fallback to the package title when the product table is missing
  var t = String(pkgText || '');
  if (!r.internetTier) { var it = t.match(/Internet\s+(100|300|500|1 Gig|2 Gig|Gig|Premier|Advantage|Ultra)/i); if (it) r.internetTier = it[1]; }
  if (!r.mobileLines) { var ml = t.match(/(\d+)\s+(Unlimited Plus|Unlimited|By the Gig)\s+Lines?/i); if (ml) { r.mobileLines = +ml[1]; r.mobilePlan = ml[2]; } }
  return r;
}

// ─── Fiscal month (Charter: 29th of previous month → 28th) ──────────
function actFiscalMonth_(ymd) {
  var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  var y = +m[1], mo = +m[2], d = +m[3];
  if (d >= 29) { mo++; if (mo > 12) { mo = 1; y++; } }
  return y + '-' + ('0' + mo).slice(-2);
}

// ─── Sheet helpers ──────────────────────────────────────────────────
function actSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(ACT_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ACT_SHEET_NAME);
    sh.getRange(1, 1, sh.getMaxRows(), ACT_HEADERS.length).setNumberFormat('@'); // keep long account numbers intact
    sh.getRange(1, 1, 1, ACT_HEADERS.length).setValues([ACT_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  var missing = ACT_HEADERS.filter(function (h) { return have.indexOf(h) < 0; });
  if (missing.length) {
    var c = have.filter(String).length + 1;
    sh.getRange(1, c, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sh.getRange(2, c, Math.max(sh.getMaxRows() - 1, 1), missing.length).setNumberFormat('@');
  }
  return sh;
}
function actReadAll_(sh) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var rows = [];
  if (lastRow > 1) {
    var vals = sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    vals.forEach(function (v, i) {
      var o = { _row: i + 2 };
      headers.forEach(function (h, j) { if (h) o[h] = v[j]; });
      rows.push(o);
    });
  }
  return { headers: headers, rows: rows };
}
function actSave_(obj, system) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = actSheet_();
    var data = actReadAll_(sh);
    var tz = Session.getScriptTimeZone();
    var existing = obj.ID ? data.rows.filter(function (r) { return r.ID === obj.ID; })[0] : null;
    var rec = existing ? JSON.parse(JSON.stringify(existing)) : {
      ID: 'M' + Date.now(), Source: 'Manual', EnteredBy: 'Joel',
      CreatedAt: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss")
    };
    if (!existing && system) Object.keys(system).forEach(function (k) { rec[k] = system[k]; });
    ACT_EDITABLE.forEach(function (k) { if (obj[k] !== undefined) rec[k] = String(obj[k]).trim(); });
    if (rec.MobileType && ACT_MOBILE_TYPES.indexOf(rec.MobileType) < 0) throw new Error('Tipo de línea no válido.');
    if (rec.MobileOrder) rec.MobileOrder = String(rec.MobileOrder).replace(/[^\d,]+/g, ',').replace(/^,|,$/g, '');
    if (!rec.AccountNumber) throw new Error('Account number is required.');
    rec.AccountNumber = String(rec.AccountNumber).replace(/\D/g, '');
    if (!rec.OrderDate) rec.OrderDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    rec.FiscalMonth = actFiscalMonth_(rec.OrderDate);
    rec.RepID = String(rec.RepID || '').toUpperCase();
    if (!rec.Employee && actRepMap_()[rec.RepID]) rec.Employee = actRepMap_()[rec.RepID];
    var row = data.headers.map(function (h) { return rec[h] === undefined || rec[h] === null ? '' : String(rec[h]); });
    var target = existing ? existing._row : sh.getLastRow() + 1;
    sh.getRange(target, 1, 1, data.headers.length).setNumberFormat('@').setValues([row]);
    delete rec._row;
    return rec;
  } finally {
    lock.releaseLock();
  }
}
function actDelete_(id) {
  if (!id) throw new Error('Missing id.');
  var sh = actSheet_();
  var r = actReadAll_(sh).rows.filter(function (x) { return x.ID === id; })[0];
  if (!r) throw new Error('Activation not found.');
  sh.deleteRow(r._row);
  return { deleted: id };
}
