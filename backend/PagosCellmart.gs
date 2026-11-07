/**
 * PagosCellmart.gs — Depósitos de Cellmart leídos del correo (v65)
 *
 * Dos tipos de correo:
 *  1) Aviso de QuickBooks: "CellMart, LLC has scheduled a payment" → monto y día del depósito.
 *  2) Correos de Cellmart que explican un pago: residuales, incentivos / ayuda, SMB, spiffs,
 *     y "comisión aplicada a factura" (lo que Cellmart toma de un pago de comisiones para una factura).
 *
 * Se revisa solo cada 15 minutos: importSpectrumOrders (Activaciones.gs) llama a pagScan_().
 * La primera vez carga todo desde junio 2026. No hace falta crear otro trigger.
 *
 * Acciones (solo manager, después de authGate_):
 *   getCellmartPayments → depósitos ya ligados a su explicación (+ facturas abiertas y lo pedido a Cellmart)
 *   pagRescan           → revisa el correo ahora y regresa lo mismo
 *   pagAskDraft         → (v66) borrador en inglés a commissions@cellmart.us preguntando por depósitos sin explicar
 *   pagSetExpected      → (v66) el Hub guarda cuánto espera en cada pago, para la alerta por correo
 *   pagBillSet          → (v66) monto o "ya la pagué" de una factura de teléfonos
 *
 * v66: alerta por correo cuando un aviso de QuickBooks se sale ±10% de lo esperado, o cuando cae un depósito
 *      que nadie explicó; facturas de teléfonos (IVC…) leídas del correo para el flujo de caja; y la respuesta
 *      de Cellmart a una pregunta del Hub explica el depósito aunque no traiga el monto.
 *
 * Los pagos de comisiones salen cada dos lunes (mismo ancla que el Hub: 12 oct 2026) y caen
 * en el banco de 0 a 3 días después. Lo que llega en otra fecha se liga a su correo por el monto.
 */
var PAG_SHEET = 'PagosCellmart';
var PAG_HEADERS = ['MsgId', 'Kind', 'EmailDate', 'Deposit', 'Amount', 'Amounts', 'Type', 'Invoice', 'PayoutDate', 'From', 'Subject', 'Text', 'Created', 'Ref'];
// Kind: deposit (QuickBooks) · note (Cellmart explica un pago) · bill (factura IVC) · billpaid (respondiste "paid")
//       answer (Cellmart contestó una pregunta del Hub; Ref = depósitos que explica)
var PAG_QBO_QUERY = 'from:do-not-reply@intuit.com subject:"CellMart, LLC has scheduled a payment"';
var PAG_NOTE_QUERY = 'from:cellmart.us (residual OR residuals OR incentive OR SMB OR spiff OR applied OR "direct deposit" OR "bank account")';
var PAG_ANCHOR = '2026-10-12';     // un lunes de pago de Cellmart (cada 14 días)
var PAG_FROM = '2026/05/31';       // primera carga
var PAG_BILL_QUERY = 'from:cellmart.us subject:IVC';
var PAG_ASK_TO = 'commissions@cellmart.us';   // dudas de comisiones (sin copiar a Maria)
var PAG_ALERT_PCT = 0.10;          // alerta si el aviso se sale ±10% de lo esperado
var PAG_HUB_URL = 'https://mircommllc.github.io/mircomm-inventory/';

var PAG_ACTIONS = { getCellmartPayments: 1, pagRescan: 1, pagAskDraft: 1, pagSetExpected: 1, pagBillSet: 1 };
function pagosRouter_(e) {
  var p = (e && e.parameter) || {};
  if (!PAG_ACTIONS[p.action]) return null;
  var out;
  try {
    if (p.action === 'pagSetExpected') out = pagSetExpected_(p.data);
    else {
      if (p.action === 'pagRescan') pagScan_();
      var extra = {};
      if (p.action === 'pagAskDraft') extra.draft = pagAskDraft_(String(p.ids || '').split(',').filter(Boolean));
      if (p.action === 'pagBillSet') pagBillSet_(p);
      out = pagView_();
      if (extra.draft) out.draft = extra.draft;
    }
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
/** Lo que ve el Hub: depósitos ligados + estado de lo pedido a Cellmart + facturas abiertas. */
function pagView_() {
  var props = PropertiesService.getScriptProperties();
  var out = pagLink_(pagRows_(), pagJson_(props, 'PAG_BILLS'), pagYmdNow_());
  var asked = pagAskStatus_(pagJson_(props, 'PAG_ASKED'));
  out.deposits.forEach(function (d) { if (asked[d.id]) d.asked = asked[d.id]; });
  return out;
}
function pagJson_(props, key) { try { return JSON.parse((props || PropertiesService.getScriptProperties()).getProperty(key) || '{}') || {}; } catch (e) { return {}; } }
function pagYmdNow_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

// ─── Leer el correo ─────────────────────────────────────────────────
/** Revisa el correo y guarda lo nuevo. La primera vez (o si se borra la hoja) carga desde junio 2026. */
function pagScan_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { added: 0, busy: true };
  try {
    var sh = pagSheet_(), props = PropertiesService.getScriptProperties();
    var full = props.getProperty('PAG_BACKFILL') !== 'done';
    var when = full ? ' after:' + PAG_FROM : ' newer_than:21d';
    var seen = {};
    pagRows_(sh).forEach(function (r) { seen[r.MsgId] = 1; });
    var tz = Session.getScriptTimeZone(), now = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss"), out = [];
    pagEach_(PAG_QBO_QUERY + when, full ? 600 : 60, function (msg) {
      var id = msg.getId();
      if (seen[id]) return; seen[id] = 1;
      var day = Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd');
      var q = pagParseQbo_(msg.getPlainBody() || pagText_(msg.getBody()), day);
      if (!q) return;
      out.push({ MsgId: id, Kind: 'deposit', EmailDate: day, Deposit: q.deposit, Amount: q.amount, Amounts: '', Type: '', Invoice: '',
        PayoutDate: '', From: 'QuickBooks', Subject: msg.getSubject(), Text: '', Created: now });
    });
    pagEach_(PAG_NOTE_QUERY + when, full ? 400 : 60, function (msg) {
      var id = msg.getId();
      if (seen[id] || !/cellmart\.us/i.test(msg.getFrom())) return; seen[id] = 1;
      var day = Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd');
      var n = pagParseNote_(msg.getSubject(), msg.getPlainBody() || pagText_(msg.getBody()), day);
      if (!n) return;
      out.push({ MsgId: id, Kind: 'note', EmailDate: day, Deposit: n.deposit, Amount: n.amount, Amounts: n.amounts.join(' '), Type: n.type,
        Invoice: n.invoice, PayoutDate: n.payout, From: pagFromName_(msg.getFrom()), Subject: msg.getSubject(), Text: n.text, Created: now });
    });
    // Facturas de teléfonos y accesorios (IVC…): el monto viene en el PDF adjunto
    var billFull = props.getProperty('PAG_BILL_BACKFILL') !== 'done';
    var me = escMe_();
    pagEach_(PAG_BILL_QUERY + (billFull ? ' after:' + PAG_FROM : ' newer_than:21d'), billFull ? 300 : 60, function (msg) {
      var id = msg.getId();
      if (seen[id]) return;
      var day = Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd'), from = String(msg.getFrom()).toLowerCase();
      var body = msg.getPlainBody() || pagText_(msg.getBody());
      if (from.indexOf(me) >= 0) {   // tú contestaste "Paid" en el hilo de la factura
        var ivc = pagInvoiceOf_(msg.getSubject());
        if (ivc && /\b(paid|pagad[ao]|ya (se )?pag[oó])\b/i.test(pagOwnText_(body))) {
          seen[id] = 1;
          out.push({ MsgId: id, Kind: 'billpaid', EmailDate: day, Invoice: ivc, From: 'Tú', Subject: msg.getSubject(), Text: pagOwnText_(body).replace(/\s+/g, ' ').slice(0, 140), Created: now });
        }
        return;
      }
      if (!/cellmart\.us/i.test(from)) return;
      var b = pagParseBill_(msg.getSubject(), body);
      if (!b) return;
      seen[id] = 1;
      var hasPdf = msg.getAttachments().some(function (a) { return /pdf/i.test(a.getContentType()) && /IVC/i.test(a.getName()); });
      out.push({ MsgId: id, Kind: 'bill', EmailDate: day, Amount: b.amount, Invoice: b.invoice, From: pagFromName_(msg.getFrom()),
        Subject: msg.getSubject(), Text: b.text, Created: now, Ref: b.amount === '' && hasPdf && pagDiff_(day, pagYmdNow_()) <= 60 ? 'pdf' : '' });
    });
    if (billFull) props.setProperty('PAG_BILL_BACKFILL', 'done');
    // Respuestas de Cellmart a lo que el Hub preguntó (aunque no traigan el monto)
    out = out.concat(pagAnswers_(seen, now));
    if (out.length) {
      var vals = out.map(function (o) { return PAG_HEADERS.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); }); });
      sh.getRange(sh.getLastRow() + 1, 1, vals.length, PAG_HEADERS.length).setNumberFormat('@').setValues(vals);
    }
    if (full) props.setProperty('PAG_BACKFILL', 'done');
    pagPdfAmounts_(sh, 4);
    try { pagAlerts_(); } catch (err) { Logger.log('pagAlerts_: ' + err); }
    return { added: out.length };
  } finally {
    lock.releaseLock();
  }
}
function pagEach_(query, max, fn) {
  var start = 0, batch = 100;
  while (start < max) {
    var threads = GmailApp.search(query, start, Math.min(batch, max - start));
    if (!threads.length) break;
    threads.forEach(function (th) { th.getMessages().forEach(fn); });
    start += threads.length;
    if (threads.length < batch) break;
  }
}
function pagSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(PAG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PAG_SHEET);
    sh.getRange(1, 1, sh.getMaxRows(), PAG_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, PAG_HEADERS.length).setValues([PAG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    PropertiesService.getScriptProperties().deleteProperty('PAG_BACKFILL');   // hoja nueva → carga completa
    PropertiesService.getScriptProperties().deleteProperty('PAG_BILL_BACKFILL');
  } else if (sh.getLastColumn() < PAG_HEADERS.length) {   // v66 agrega columnas al final
    sh.getRange(1, 1, 1, PAG_HEADERS.length).setValues([PAG_HEADERS]).setFontWeight('bold');
    sh.getRange(1, 1, sh.getMaxRows(), PAG_HEADERS.length).setNumberFormat('@');
  }
  return sh;
}
function pagRows_(sh) {
  sh = sh || pagSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = sh.getRange(1, 1, 1, PAG_HEADERS.length).getValues()[0].map(String);
  return sh.getRange(2, 1, last - 1, PAG_HEADERS.length).getDisplayValues().map(function (v) {
    var o = {}; head.forEach(function (h, j) { o[h] = v[j]; }); return o;
  });
}

// ─── Pure: leer cada correo (se prueban fuera de Apps Script) ─────────
var PAG_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function pagText_(html) {
  return String(html || '').replace(/<br\s*\/?>|<\/(p|div|tr|td|th|li)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#36;/g, '$').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
function pagYmd_(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
function pagAddDays_(ymd, n) {
  var p = String(ymd).split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
}
function pagDiff_(a, b) {   // días de a a b
  var pa = String(a).split('-'), pb = String(b).split('-');
  return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 864e5);
}
/** "…sent you a payment of $4805.00, which will be paid on November 10th." → { amount: 4805, deposit: '2026-11-10' } */
function pagParseQbo_(text, emailYmd) {
  var t = String(text || '').replace(/\s+/g, ' ');
  var a = t.match(/payment of \$\s?([\d,]+(?:\.\d{1,2})?)/i);
  var d = t.match(/paid on ([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (!a) return null;
  var amount = +a[1].replace(/,/g, ''), deposit = emailYmd;
  if (d && PAG_MONTHS[d[1].toLowerCase()]) {
    var y = +emailYmd.slice(0, 4), m = PAG_MONTHS[d[1].toLowerCase()], em = +emailYmd.slice(5, 7);
    if (m < em - 6) y++; else if (m > em + 6) y--;   // diciembre → enero
    deposit = pagYmd_(y, m, +d[2]);
  }
  return { amount: amount, deposit: deposit };
}
/** Solo el mensaje nuevo (sin lo citado de correos anteriores). */
function pagOwnText_(body) {
  var t = String(body || '').replace(/\r/g, '');
  var cut = t.search(/\n\s*(From:\s|On .{5,80} wrote:|_{8,}|-{5,}\s*Original Message)/i);
  return (cut > 0 ? t.slice(0, cut) : t).trim();
}
/** Clasifica un correo de Cellmart y saca montos, fechas y factura. null = no habla de un pago. */
function pagParseNote_(subject, body, emailYmd) {
  var own = pagOwnText_(body), s = String(subject || ''), all = s + '\n' + own, type = '';
  var inv = all.match(/\bIVC\s*0*(\d{3,})/i);
  if (/applied\s+\$\s?[\d,.]+\s+from\s+your\s+commission/i.test(own) || /commission\s+applied\s+to/i.test(s) && /applied/i.test(own)) type = 'invoice';
  else if (/spiff/i.test(all) && /applied/i.test(own) && inv) type = 'spiff_credit';
  else if (/residual/i.test(all)) type = 'residual';
  else if (/incentive|financial assistance/i.test(all)) type = 'incentive';
  else if (/\bSMB\b/.test(all) && /payment|commission/i.test(all)) type = 'smb';
  else if (/spiff/i.test(all) && /pay|deposit/i.test(own)) type = 'spiff';
  if (!type) return null;
  var amounts = [], m, re = /\$\s?([\d,]+(?:\.\d{1,2})?)/g;
  while ((m = re.exec(own))) { var v = +m[1].replace(/,/g, ''); if (v > 0 && amounts.indexOf(v) < 0) amounts.push(v); }
  var amount = '';
  if (type === 'invoice') { var ia = own.match(/applied\s+\$\s?([\d,]+(?:\.\d{1,2})?)/i); if (ia) amount = +ia[1].replace(/,/g, ''); }
  else if (type === 'spiff_credit') { var sa = own.match(/(?:total amount|applied)[^$]{0,40}\$\s?([\d,]+(?:\.\d{1,2})?)/i); if (sa) amount = +sa[1].replace(/,/g, ''); }
  // Fecha del pago que se menciona: "payout 10/26/26", "posted … on Tuesday 11/3/2026", "processed today", "tomorrow"
  var toYmd = function (x) { var q = x.split('/'); var y = +q[2]; if (y < 100) y += 2000; return pagYmd_(y, +q[0], +q[1]); };
  var po = own.match(/payout\s+(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  var dep = own.match(/(?:posted|deposit(?:ed)?|bank account|initiated)[^.\n]{0,60}?(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  var deposit = dep ? toYmd(dep[1]) : /tomorrow/i.test(own) ? pagAddDays_(emailYmd, 1) : /\b(today|processed today)\b/i.test(own) ? emailYmd : '';
  var text = own.replace(/\s+/g, ' ').slice(0, 280);
  return { type: type, amounts: amounts, amount: amount, invoice: inv ? 'IVC' + ('00000' + inv[1]).slice(-5) : '', payout: po ? toYmd(po[1]) : '', deposit: deposit, text: text };
}
function pagFromName_(from) { var m = String(from || '').match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : String(from || ''); }

/** Lunes de pago de comisiones al que pertenece un depósito (cae de 0 a 3 días después), o ''. */
function pagCycleFor_(ymd) {
  var d = pagDiff_(PAG_ANCHOR, ymd), back = ((d % 14) + 14) % 14;
  return back <= 3 ? pagAddDays_(ymd, -back) : '';
}

/** Liga cada depósito con su explicación. Pure. bills = lo que marcaste en el Hub {IVC: {amount, paid}}; today 'yyyy-MM-dd'. */
function pagLink_(rows, bills, today) {
  var deps = rows.filter(function (r) { return r.Kind === 'deposit' && +r.Amount > 0; })
    .sort(function (a, b) { return a.Deposit < b.Deposit ? -1 : a.Deposit > b.Deposit ? 1 : 0; });
  var notes = rows.filter(function (r) { return r.Kind === 'note'; }).map(function (r) {
    return { id: r.MsgId, date: r.EmailDate, type: r.Type, amounts: String(r.Amounts || '').split(' ').filter(Boolean).map(Number),
      amount: r.Amount === '' ? null : +r.Amount, invoice: r.Invoice, payout: r.PayoutDate, deposit: r.Deposit, from: r.From, subject: r.Subject, text: r.Text,
      used: false, usedAmts: [] };
  });
  var paidTypes = { residual: 1, incentive: 1, smb: 1, spiff: 1 };
  var near = function (n, D) { return Math.abs(pagDiff_(n.deposit || n.date, D)); };
  // 1) Por monto: un correo puede explicar varios depósitos (p. ej. incentivo de agosto $770 y de septiembre $1,190)
  var out = deps.map(function (r) {
    var amt = +r.Amount, D = r.Deposit;
    var hit = function (n) { return n.amounts.some(function (v) { return Math.abs(v - amt) < 0.005 && n.usedAmts.indexOf(v) < 0; }); };
    var cands = notes.filter(function (n) { return paidTypes[n.type] && hit(n) && near(n, D) <= 10; })
      .sort(function (a, b) { return near(a, D) - near(b, D); });
    var d = { id: r.MsgId, announced: r.EmailDate, deposit: D, amount: amt, type: 'unknown', cycle: '', note: null, cuts: [], how: '' };
    if (cands.length) { var n = cands[0]; n.used = true; n.usedAmts.push(amt); d.type = n.type; d.note = pagNoteOut_(n); d.how = 'monto'; }
    else if ((d.cycle = pagCycleFor_(D))) d.type = 'commission';
    return d;
  });
  // 2) Correos sin monto en el texto (el detalle viene en un Excel adjunto, como el SMB): por fecha, solo para
  //    depósitos fuera del ciclo que siguen sin explicar
  out.forEach(function (d) {
    if (d.type !== 'unknown') return;
    var n = notes.filter(function (x) { return paidTypes[x.type] && !x.used && !x.amounts.length && near(x, d.deposit) <= 4; })
      .sort(function (a, b) { return near(a, d.deposit) - near(b, d.deposit); })[0];
    if (n) { n.used = true; d.type = n.type; d.note = pagNoteOut_(n); d.how = 'fecha'; }
  });
  // 3) Cellmart contestó la pregunta del Hub sobre ese depósito (v66)
  rows.filter(function (r) { return r.Kind === 'answer'; }).forEach(function (r) {
    String(r.Ref || '').split(/[\s,]+/).filter(Boolean).forEach(function (id) {
      var d = out.filter(function (x) { return x.id === id && x.type === 'unknown'; })[0];
      if (!d) return;
      d.type = paidTypes[r.Type] ? r.Type : 'answered'; d.how = 'respuesta';
      d.note = { id: r.MsgId, date: r.EmailDate, type: r.Type || 'answered', amount: r.Amount === '' ? null : +r.Amount, amounts: [], invoice: r.Invoice,
        payout: '', deposit: '', from: r.From, subject: r.Subject, text: r.Text };
    });
  });
  // Facturas pagadas con comisiones: se ligan al pago de comisiones de esa fecha
  notes.filter(function (n) { return n.type === 'invoice'; }).forEach(function (n) {
    var cyc = n.payout || pagCycleFor_(n.date) || '';
    var dep = out.filter(function (d) { return d.type === 'commission' && (d.cycle === cyc || (!cyc && Math.abs(pagDiff_(d.cycle, n.date)) <= 3)); })[0];
    if (dep) { dep.cuts.push(pagNoteOut_(n)); n.used = true; }
  });
  var credits = notes.filter(function (n) { return !n.used && (n.type === 'spiff_credit' || n.type === 'invoice'); }).map(pagNoteOut_);
  var loose = notes.filter(function (n) { return !n.used && paidTypes[n.type]; }).map(pagNoteOut_);   // explican un pago que no ha llegado
  return { deposits: out.reverse(), credits: credits.reverse(), pendingNotes: loose.reverse(), bills: pagBills_(rows, notes, bills || {}, today || ''),
    scanned: new Date().toISOString() };
}
function pagNoteOut_(n) {
  return { id: n.id, date: n.date, type: n.type, amount: n.amount, amounts: n.amounts, invoice: n.invoice, payout: n.payout, deposit: n.deposit, from: n.from, subject: n.subject, text: n.text };
}

// ─── v66 · Facturas de teléfonos (IVC…) ─────────────────────────────
/** "IVC01344 - MirComm LLC - 10/28/26", "Reminder: MirComm - Accessories - IVC01182", "IVC1233" → 'IVC01344' */
function pagInvoiceOf_(subject) {
  var m = String(subject || '').match(/\bIVC\s*0*(\d{3,})/i);
  return m ? 'IVC' + ('00000' + m[1]).slice(-5) : '';
}
/** Correo de Cellmart que manda o recuerda una factura. null = otra cosa (comisión o spiff aplicado, envíos…). Pure. */
function pagParseBill_(subject, body) {
  var s = String(subject || ''), own = pagOwnText_(body), inv = pagInvoiceOf_(s);
  if (!inv) return null;
  if (/applied|spiff|commission/i.test(s) || /\bapplied\b/i.test(own) && !/due invoice|attached the invoice/i.test(own)) return null;
  var isBill = /^\s*(re:\s*|fw:\s*)?IVC/i.test(s) || /reminder/i.test(s) || /invoice/i.test(own);
  if (!isBill) return null;
  var esc = inv.replace(/^IVC0*/, '');
  var re = new RegExp('IVC\\s*0*' + esc + '\\s*[-–:]\\s*\\$\\s?([\\d,]+(?:\\.\\d{1,2})?)', 'i');
  var a = own.match(re) || own.match(/(?:balance(?: due)?|amount due|total due|total)\s*(?:of|is|:)?\s*\$\s?([\d,]+(?:\.\d{1,2})?)/i);
  return { invoice: inv, amount: a ? +a[1].replace(/,/g, '') : '', text: own.replace(/\s+/g, ' ').slice(0, 200) };
}
/** Total de una factura leído del texto del PDF. Pure. */
function pagInvoiceTotal_(text) {
  var t = String(text || '').replace(/ /g, ' ');
  var keys = [/balance\s*due[^\d$]{0,20}\$?\s*([\d,]+\.\d{2})/i, /amount\s*due[^\d$]{0,20}\$?\s*([\d,]+\.\d{2})/i, /total\s*due[^\d$]{0,20}\$?\s*([\d,]+\.\d{2})/i,
    /\btotal\b[^\d$\n]{0,20}\$?\s*([\d,]+\.\d{2})/i];
  for (var i = 0; i < keys.length; i++) { var m = t.match(keys[i]); if (m && +m[1].replace(/,/g, '') > 0) return +m[1].replace(/,/g, ''); }
  var all = (t.match(/\$\s?[\d,]+\.\d{2}/g) || []).map(function (x) { return +x.replace(/[$,\s]/g, ''); });
  return all.length ? Math.max.apply(null, all) : '';
}
/** El PDF se convierte un momento a Google Doc en tu Drive para leer el texto y se borra. Si Drive no deja, regresa ''. */
function pagPdfText_(blob) {
  var token = ScriptApp.getOAuthToken(), auth = { Authorization: 'Bearer ' + token }, bd = 'pagivc' + Date.now();
  var head = Utilities.newBlob('--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name: 'tmp-hub-' + blob.getName(), mimeType: 'application/vnd.google-apps.document' }) +
    '\r\n--' + bd + '\r\nContent-Type: application/pdf\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + bd + '--').getBytes();
  var r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'post', headers: auth,
    contentType: 'multipart/related; boundary=' + bd, payload: head.concat(blob.getBytes()).concat(tail), muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Drive ' + r.getResponseCode());
  var id = JSON.parse(r.getContentText()).id;
  try {
    var x = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', { headers: auth, muteHttpExceptions: true });
    return x.getResponseCode() < 300 ? x.getContentText() : '';
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, { method: 'delete', headers: auth, muteHttpExceptions: true });
  }
}
/** Lee el monto del PDF de las facturas que lo tienen pendiente (Ref = 'pdf'), pocas por vuelta. */
function pagPdfAmounts_(sh, max) {
  var props = PropertiesService.getScriptProperties();
  if ((props.getProperty('PAG_PDF_OFF') || '') > pagYmdNow_()) return;   // Drive no dejó: se reintenta en una semana
  var last = sh.getLastRow(); if (last < 2) return;
  var head = sh.getRange(1, 1, 1, PAG_HEADERS.length).getValues()[0].map(String);
  var cRef = head.indexOf('Ref'), cAmt = head.indexOf('Amount'), cId = head.indexOf('MsgId');
  if (cRef < 0) return;
  var vals = sh.getRange(2, 1, last - 1, PAG_HEADERS.length).getDisplayValues(), done = 0;
  for (var i = vals.length - 1; i >= 0 && done < max; i--) {
    if (vals[i][cRef] !== 'pdf') continue;
    done++;
    var amt = '', state = 'pdf-no';
    try {
      var msg = GmailApp.getMessageById(vals[i][cId]);
      var pdf = msg.getAttachments().filter(function (a) { return /pdf/i.test(a.getContentType()); })[0];
      if (pdf) { amt = pagInvoiceTotal_(pagPdfText_(pdf.copyBlob())); state = amt === '' ? 'pdf-no' : 'pdf-ok'; }
    } catch (err) {
      Logger.log('PDF factura: ' + err);
      if (/Drive (401|403)/.test(String(err))) { props.setProperty('PAG_PDF_OFF', pagAddDays_(pagYmdNow_(), 7)); return; }
    }
    sh.getRange(i + 2, cAmt + 1).setValue(amt === '' ? '' : String(amt));
    sh.getRange(i + 2, cRef + 1).setValue(state);
  }
}
/** Facturas con su saldo: monto (PDF, correo o lo que escribiste) − comisión o spiff aplicados. Pure. */
function pagBills_(rows, notes, manual, today) {
  var by = {};
  rows.forEach(function (r) {
    if (r.Kind !== 'bill' && r.Kind !== 'billpaid') return;
    var b = by[r.Invoice] = by[r.Invoice] || { invoice: r.Invoice, date: r.EmailDate, last: r.EmailDate, amount: null, msgId: r.MsgId, from: r.From, paidMail: '', pdf: '' };
    if (r.EmailDate < b.date) { b.date = r.EmailDate; b.msgId = r.MsgId; }
    if (r.EmailDate > b.last) b.last = r.EmailDate;
    if (r.Kind === 'billpaid') { b.paidMail = r.EmailDate; return; }
    if (r.Amount !== '' && !isNaN(+r.Amount)) b.amount = Math.max(b.amount || 0, +r.Amount);
    if (/^pdf/.test(r.Ref || '')) b.pdf = r.Ref;
  });
  return Object.keys(by).map(function (k) {
    var b = by[k], m = manual[k] || {};
    if (m.amount !== undefined && m.amount !== '' && !isNaN(+m.amount)) { b.amount = +m.amount; b.amountBy = 'tú'; }
    var applied = 0, closedBy = '';
    notes.forEach(function (n) {
      if (n.invoice !== k) return;
      if (n.type === 'invoice') { applied += +n.amount || 0; closedBy = closedBy || 'Comisión aplicada ' + n.date; }
      else if (n.type === 'spiff_credit') applied += +n.amount || 0;
    });
    b.applied = Math.round(applied * 100) / 100;
    b.balance = b.amount === null ? null : Math.max(0, Math.round((b.amount - applied) * 100) / 100);
    b.status = m.paid ? 'paid' : b.paidMail ? 'paid' : closedBy ? 'paid' : b.balance !== null && b.balance < 0.5 ? 'paid'
      : today && pagDiff_(b.last, today) > 60 ? 'old' : 'open';
    b.paidHow = m.paid ? 'Marcada pagada ' + m.paid : b.paidMail ? 'Contestaste "paid" ' + b.paidMail : closedBy;
    return b;
  }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
}
function pagBillSet_(p) {
  var inv = pagInvoiceOf_(p.invoice);
  if (!inv) throw new Error('Falta la factura.');
  var props = PropertiesService.getScriptProperties(), all = pagJson_(props, 'PAG_BILLS'), b = all[inv] || {};
  if (p.amount !== undefined && p.amount !== '') { var a = +String(p.amount).replace(/[$,\s]/g, ''); if (isNaN(a) || a < 0) throw new Error('Monto inválido.'); b.amount = a; }
  if (p.paid === '1') b.paid = pagYmdNow_(); else if (p.paid === '0') delete b.paid;
  all[inv] = b;
  props.setProperty('PAG_BILLS', JSON.stringify(all));
}

// ─── v66 · Pedir explicación a Cellmart ─────────────────────────────
function pagMoney_(n) { return '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function pagEsDate_(ymd) {   // 'mar 10 nov'
  var p = String(ymd).split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  return ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][dt.getUTCDay()] + ' ' + +p[2] + ' ' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][+p[1] - 1];
}
function pagUsDate_(ymd) { var p = String(ymd).split('-'); return +p[1] + '/' + +p[2] + '/' + p[0]; }
/** Texto del correo (en inglés, como lo escribe Joel). Pure. */
function pagAskText_(deps) {
  var one = deps.length === 1;
  var lines = deps.map(function (d) { return '- ' + pagMoney_(d.amount) + ' deposited on ' + pagUsDate_(d.deposit) + ' (QuickBooks notice from ' + pagUsDate_(d.announced) + ')'; });
  return {
    subject: one ? 'Question about payment of ' + pagMoney_(deps[0].amount) + ' on ' + pagUsDate_(deps[0].deposit) : 'Question about ' + deps.length + ' payments from CellMart',
    text: 'Hi,\n\n' + (one ? 'I received this payment from CellMart and I couldn\'t match it to a commission payout or to an email explaining it:'
      : 'I received these payments from CellMart and I couldn\'t match them to a commission payout or to an email explaining them:') +
      '\n\n' + lines.join('\n') + '\n\nCould you let me know what ' + (one ? 'it is' : 'each one is') + ' for (residual, spiff, incentive, etc.) and send me the detail if there is one?' +
      '\n\nThank you,\nJoel Chavez\nMirComm LLC'
  };
}
/** Crea el borrador (no lo manda). Regresa el id del mensaje para abrirlo en Gmail. */
function pagAskDraft_(ids) {
  if (!ids.length) throw new Error('No hay depósitos seleccionados.');
  var view = pagLink_(pagRows_(), {}, pagYmdNow_());
  var deps = view.deposits.filter(function (d) { return ids.indexOf(d.id) >= 0; })
    .sort(function (a, b) { return a.deposit < b.deposit ? -1 : 1; });
  if (!deps.length) throw new Error('No encontré esos depósitos.');
  var t = pagAskText_(deps);
  var draft = GmailApp.createDraft(PAG_ASK_TO, t.subject, t.text, { name: escFromName_() });
  var msg = draft.getMessage(), props = PropertiesService.getScriptProperties(), asked = pagJson_(props, 'PAG_ASKED');
  var rec = { date: pagYmdNow_(), thread: msg.getThread().getId(), msg: msg.getId(), ids: deps.map(function (d) { return d.id; }) };
  rec.ids.forEach(function (id) { asked[id] = rec; });
  props.setProperty('PAG_ASKED', JSON.stringify(asked));
  return { msgId: msg.getId(), subject: t.subject, n: deps.length };
}
/** Por cada depósito preguntado: borrador sin mandar, enviado esperando respuesta, o ya contestado. */
function pagAskStatus_(asked) {
  var out = {}, threads = {}, me = escMe_();
  Object.keys(asked).forEach(function (id) {
    var a = asked[id];
    if (!threads[a.thread]) {
      var st = { date: a.date, msg: a.msg, state: 'gone' };
      try {
        var th = GmailApp.getThreadById(a.thread);
        if (th) {
          var ms = th.getMessages();
          var sent = ms.filter(function (m) { return !m.isDraft() && String(m.getFrom()).toLowerCase().indexOf(me) >= 0; })[0];
          var draft = ms.filter(function (m) { return m.isDraft(); })[0];
          var reply = sent && ms.filter(function (m) { return !m.isDraft() && /cellmart\.us/i.test(m.getFrom()) && m.getDate() > sent.getDate(); })[0];
          st.state = reply ? 'answered' : sent ? 'sent' : draft ? 'draft' : 'gone';
          if (sent) st.sent = Utilities.formatDate(sent.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
          if (draft) st.msg = draft.getId();
          if (reply) st.reply = reply.getId();
        }
      } catch (e) {}
      threads[a.thread] = st;
    }
    out[id] = threads[a.thread];
  });
  return out;
}
/** Respuestas nuevas de Cellmart en los hilos preguntados → filas 'answer'. */
function pagAnswers_(seen, now) {
  var asked = pagJson_(null, 'PAG_ASKED'), byThread = {}, out = [], me = escMe_(), tz = Session.getScriptTimeZone();
  Object.keys(asked).forEach(function (id) { var a = asked[id]; (byThread[a.thread] = byThread[a.thread] || []).push(id); });
  Object.keys(byThread).forEach(function (tid) {
    try {
      var th = GmailApp.getThreadById(tid); if (!th) return;
      var sentAt = null;
      th.getMessages().forEach(function (m) {
        if (m.isDraft()) return;
        if (String(m.getFrom()).toLowerCase().indexOf(me) >= 0) { sentAt = sentAt || m.getDate(); return; }
        if (!sentAt || !/cellmart\.us/i.test(m.getFrom()) || seen[m.getId()]) return;
        seen[m.getId()] = 1;
        var day = Utilities.formatDate(m.getDate(), tz, 'yyyy-MM-dd'), body = m.getPlainBody() || pagText_(m.getBody());
        var n = pagParseNote_(m.getSubject(), body, day) || {};
        out.push({ MsgId: m.getId(), Kind: 'answer', EmailDate: day, Amount: n.amount, Type: n.type || '', Invoice: n.invoice || '',
          From: pagFromName_(m.getFrom()), Subject: m.getSubject(), Text: pagOwnText_(body).replace(/\s+/g, ' ').slice(0, 280), Created: now, Ref: byThread[tid].join(' ') });
      });
    } catch (e) { Logger.log('pagAnswers_: ' + e); }
  });
  return out;
}

// ─── v66 · Alerta por correo ────────────────────────────────────────
/** data = JSON [{pay, exp, gross, cb, maybe, src}] — lo que el Hub espera en cada pago. */
function pagSetExpected_(data) {
  var list = []; try { list = JSON.parse(data || '[]') || []; } catch (e) { throw new Error('Datos inválidos.'); }
  var props = PropertiesService.getScriptProperties(), all = pagJson_(props, 'PAG_EXPECTED'), from = pagAddDays_(pagYmdNow_(), -30);
  list.forEach(function (x) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.pay || '')) || isNaN(+x.exp)) return;
    all[x.pay] = { exp: +x.exp, gross: +x.gross || 0, cb: +x.cb || 0, maybe: +x.maybe || 0, src: x.src === 'report' ? 'report' : 'hub', at: pagYmdNow_() };
  });
  Object.keys(all).forEach(function (k) { if (k < from) delete all[k]; });
  props.setProperty('PAG_EXPECTED', JSON.stringify(all));
  return { ok: true, saved: Object.keys(all).length };
}
/** Qué depósitos ameritan correo. Pure. alerted = ya avisados; exp = lo guardado por pagSetExpected_. */
function pagAlertsFor_(deposits, exp, alerted, today) {
  var out = [];
  deposits.forEach(function (d) {
    if (alerted[d.id] || pagDiff_(d.announced, today) > 7) return;
    if (d.type === 'unknown') {
      if (d.deposit > today) return;   // se espera a que caiga: a veces el correo que lo explica llega después del aviso
      out.push({ d: d, kind: 'unknown' });
    } else if (d.type === 'commission') {
      var e = exp[d.cycle];
      if (!e || !(e.exp > 0)) { out.push({ d: d, kind: 'skip' }); return; }
      var cut = d.cuts.reduce(function (n, c) { return n + (+c.amount || 0); }, 0), diff = d.amount + cut - e.exp;
      out.push({ d: d, kind: Math.abs(diff) > Math.max(1, e.exp * PAG_ALERT_PCT) ? 'diff' : 'ok', e: e, cut: cut, diff: diff });
    } else out.push({ d: d, kind: 'skip' });
  });
  return out;
}
function pagAlerts_() {
  var props = PropertiesService.getScriptProperties(), today = pagYmdNow_();
  var view = pagLink_(pagRows_(), pagJson_(props, 'PAG_BILLS'), today), alerted = pagJson_(props, 'PAG_ALERTED');
  if (!props.getProperty('PAG_ALERTED')) {   // primera vez: no avisar de lo viejo
    view.deposits.forEach(function (d) { if (d.deposit < today) alerted[d.id] = 'seed'; });
  }
  var list = pagAlertsFor_(view.deposits, pagJson_(props, 'PAG_EXPECTED'), alerted, today);
  list.forEach(function (a) {
    if (a.kind === 'diff' || a.kind === 'unknown') {
      var m = pagAlertMail_(a);
      MailApp.sendEmail({ to: escMe_(), subject: m.subject, body: m.text, name: 'MirComm Store Hub' });
    }
    alerted[a.d.id] = today;
  });
  Object.keys(alerted).forEach(function (k) { if (alerted[k] !== 'seed' && pagDiff_(alerted[k], today) > 120) delete alerted[k]; });
  props.setProperty('PAG_ALERTED', JSON.stringify(alerted));
}
/** Texto del aviso. Pure. */
function pagAlertMail_(a) {
  var d = a.d, when = pagEsDate_(d.deposit);
  if (a.kind === 'unknown') return {
    subject: '⚠️ Cellmart: depósito de ' + pagMoney_(d.amount) + ' del ' + when + ' sin explicar',
    text: 'Cayó un depósito de Cellmart que no es del ciclo de comisiones y ningún correo de Cellmart trae ese monto.\n\n' +
      '  Monto: ' + pagMoney_(d.amount) + '\n  Depósito: ' + when + '\n  Aviso de QuickBooks: ' + pagEsDate_(d.announced) + '\n\n' +
      'En el Hub (Activations → 🏦 Depósitos de Cellmart) está el botón "✉️ Pedir explicación" que te deja el correo listo en Gmail.\n' + PAG_HUB_URL
  };
  var e = a.e, pct = Math.round(a.diff / e.exp * 100), lines = [];
  lines.push('  Aviso de QuickBooks: ' + pagMoney_(d.amount) + ' (depósito ' + when + ')');
  if (a.cut) lines.push('  + Aplicado a facturas: ' + pagMoney_(a.cut) + ' (' + d.cuts.map(function (c) { return c.invoice; }).filter(Boolean).join(', ') + ')');
  lines.push('  ' + (e.src === 'report' ? 'Commission Report' : 'El Hub esperaba (neto)') + ': ' + pagMoney_(e.exp));
  lines.push('  Diferencia: ' + (a.diff < 0 ? '−' : '+') + pagMoney_(Math.abs(a.diff)) + ' (' + (pct > 0 ? '+' : '−') + Math.abs(pct) + '%)');
  var why = [];
  if (a.diff < 0) {
    if (e.src === 'hub' && e.cb) why.push('El Hub ya restó ' + pagMoney_(e.cb) + ' de chargebacks conocidos; lo que falta puede ser otro chargeback o una factura que Cellmart descontó sin avisar.');
    else why.push('Puede ser una factura descontada sin correo, un chargeback que el Core todavía no marca, o una venta que Cellmart no pagó.');
  } else if (e.maybe) why.push('Puede ser de las ventas "si conecta a tiempo" que sí conectaron (' + pagMoney_(e.maybe) + ' posibles).');
  return {
    subject: (a.diff < 0 ? '⚠️' : 'ℹ️') + ' Cellmart: depósito del ' + when + ' ' + pagMoney_(d.amount) + ' — ' + (a.diff < 0 ? 'faltan ' : 'sobran ') + pagMoney_(Math.abs(a.diff)) + ' (' + (pct > 0 ? '+' : '−') + Math.abs(pct) + '%)',
    text: 'El aviso de pago de Cellmart se sale más de ' + Math.round(PAG_ALERT_PCT * 100) + '% de lo esperado.\n\n' + lines.join('\n') + '\n\n' +
      (why.length ? why.join('\n') + '\n\n' : '') + 'El detalle está en el Hub → Activations → 💵 Próximos pagos (sube el Commission Report cuando salga para ver cuenta por cuenta).\n' + PAG_HUB_URL
  };
}
