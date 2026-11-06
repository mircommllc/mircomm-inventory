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
 *   getCellmartPayments → depósitos ya ligados a su explicación
 *   pagRescan           → revisa el correo ahora y regresa lo mismo
 *
 * Los pagos de comisiones salen cada dos lunes (mismo ancla que el Hub: 12 oct 2026) y caen
 * en el banco de 0 a 3 días después. Lo que llega en otra fecha se liga a su correo por el monto.
 */
var PAG_SHEET = 'PagosCellmart';
var PAG_HEADERS = ['MsgId', 'Kind', 'EmailDate', 'Deposit', 'Amount', 'Amounts', 'Type', 'Invoice', 'PayoutDate', 'From', 'Subject', 'Text', 'Created'];
var PAG_QBO_QUERY = 'from:do-not-reply@intuit.com subject:"CellMart, LLC has scheduled a payment"';
var PAG_NOTE_QUERY = 'from:cellmart.us (residual OR residuals OR incentive OR SMB OR spiff OR applied OR "direct deposit" OR "bank account")';
var PAG_ANCHOR = '2026-10-12';     // un lunes de pago de Cellmart (cada 14 días)
var PAG_FROM = '2026/05/31';       // primera carga

function pagosRouter_(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'getCellmartPayments' && p.action !== 'pagRescan') return null;
  var out;
  try {
    if (p.action === 'pagRescan') pagScan_();
    out = pagLink_(pagRows_());
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

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
    if (out.length) {
      var vals = out.map(function (o) { return PAG_HEADERS.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); }); });
      sh.getRange(sh.getLastRow() + 1, 1, vals.length, PAG_HEADERS.length).setNumberFormat('@').setValues(vals);
    }
    if (full) props.setProperty('PAG_BACKFILL', 'done');
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

/** Liga cada depósito con su explicación. Pure. */
function pagLink_(rows) {
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
  // Facturas pagadas con comisiones: se ligan al pago de comisiones de esa fecha
  notes.filter(function (n) { return n.type === 'invoice'; }).forEach(function (n) {
    var cyc = n.payout || pagCycleFor_(n.date) || '';
    var dep = out.filter(function (d) { return d.type === 'commission' && (d.cycle === cyc || (!cyc && Math.abs(pagDiff_(d.cycle, n.date)) <= 3)); })[0];
    if (dep) { dep.cuts.push(pagNoteOut_(n)); n.used = true; }
  });
  var credits = notes.filter(function (n) { return !n.used && (n.type === 'spiff_credit' || n.type === 'invoice'); }).map(pagNoteOut_);
  var loose = notes.filter(function (n) { return !n.used && paidTypes[n.type]; }).map(pagNoteOut_);   // explican un pago que no ha llegado
  return { deposits: out.reverse(), credits: credits.reverse(), pendingNotes: loose.reverse(), scanned: new Date().toISOString() };
}
function pagNoteOut_(n) {
  return { id: n.id, date: n.date, type: n.type, amount: n.amount, amounts: n.amounts, invoice: n.invoice, payout: n.payout, deposit: n.deposit, from: n.from, subject: n.subject, text: n.text };
}
