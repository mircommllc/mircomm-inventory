/**
 * Lineas.gs — 📱 UN SOLO FORMULARIO para registrar líneas móviles (v64 · Fase 2)
 * -----------------------------------------------------------------------------
 * Antes había dos: "Registrar activación móvil" (Joel, en Activations) y "Registrar línea"
 * (asesoras, en My Lines), con reglas distintas. Ahora los dos usan actRepLineSave:
 *
 *  - Asesora (usuario + PIN de 6 dígitos): mismas reglas de siempre (actRepSave_ en Activaciones.gs):
 *    máximo 7 días atrás, queda a su nombre, aviso si el tipo no cuadra con el historial de la cuenta.
 *  - Administrador (sesión de manager): puede escoger quién la hizo y registrar fechas viejas; también edita.
 *  - Los dos: si la orden ya está registrada desde el correo de Spectrum (misma cuenta, ±3 días, con internet
 *    o TV y sin línea), el backend lo detecta y pregunta si la línea se agrega a ESE registro, para que el
 *    internet no quede dos veces. Antes esto solo lo veía Joel en su formulario.
 *
 * No cambia nada de lo que ya existe: actRepSave / saveActivation siguen funcionando igual.
 * Se llama desde Code.gs → hubGet_(e):   var ln = lineasRouter_(e); if (ln) return ln;
 */

var LINE_MERGE_DAYS = 3;

function lineasRouter_(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'actRepLineSave') return null;
  var out;
  try {
    var d = JSON.parse(p.data || '{}');
    if (typeof isManagerToken_ === 'function' && isManagerToken_(p.mt)) {
      out = lineSaveAdmin_(d, p.force === '1', String(p.merge || ''));
    } else {
      var me = prosAuth_(p);   // usuario + PIN de 6 dígitos (Prospectos.gs); lanza "PIN incorrecto."
      out = lineSaveRep_(me, d, p.force === '1', String(p.merge || ''));
    }
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ─── Asesora ───────────────────────────────────────────────────────
function lineSaveRep_(me, d, force, merge) {
  var acct = String(d.AccountNumber || '').replace(/\D/g, '');
  var date = String(d.OrderDate || '').slice(0, 10);
  if (merge !== 'new') {
    var t = merge ? lineFindById_(merge) : lineMergeTarget_(acct, date, '');
    if (t && merge) return lineMerge_(t, d, me.name, { sameRules: me });
    if (t) return lineAskMerge_(t);
  }
  return actRepSave_(me, d, force);
}

// ─── Administrador ─────────────────────────────────────────────────
function lineSaveAdmin_(d, force, merge) {
  var who = typeof adminMe_ === 'function' ? adminMe_() : 'Joel';
  if (d.ID) return { ok: true, line: actSave_(d) };   // editar un registro que ya existe
  var acct = String(d.AccountNumber || '').replace(/\D/g, '');
  var lines = Math.floor(+d.MobileLines || 0);
  var type = String(d.MobileType || '');
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var date = String(d.OrderDate || today).slice(0, 10);
  if (acct.length < 9) throw new Error('Escribe el número de cuenta Spectrum completo.');
  if (!String(d.CustomerName || '').trim()) throw new Error('Escribe el nombre del cliente.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new Error('La fecha no puede ser futura.');
  if (!lines && !d.InternetTier && !d.VideoTier) throw new Error('Indica al menos un servicio (líneas, internet o TV).');
  if (lines && !(lines >= 1 && lines <= 10)) throw new Error('Líneas: escribe un número del 1 al 10.');
  if (lines && type && ACT_MOBILE_TYPES.indexOf(type) < 0) throw new Error('Tipo de línea no válido.');
  if (lines && merge !== 'new') {
    var t = merge ? lineFindById_(merge) : lineMergeTarget_(acct, date, '');
    if (t && merge) return lineMerge_(t, d, d.SoldBy || who, null);
    if (t) return lineAskMerge_(t);
  }
  var rows = actReadAll_(actSheet_()).rows;
  var order = String(d.MobileOrder || '').replace(/[^\d,]+/g, ',').replace(/^,|,$/g, '');
  var dupOrder = order && order.split(',').filter(function (o) {
    return o && rows.some(function (r) { return String(r.MobileOrder || '').split(/[^\d]+/).indexOf(o) >= 0; });
  })[0];
  if (dupOrder) throw new Error('Esa orden (' + dupOrder + ') ya está registrada.');
  if (d.PosSaleID && rows.some(function (r) { return String(r.PosSaleID) === String(d.PosSaleID); }))
    return { ok: false, already: true, message: 'La línea de la venta ' + d.PosSaleID + ' ya está registrada.' };
  if (lines && !force) {
    var same = rows.filter(function (r) {
      return String(r.AccountNumber || '').replace(/\D/g, '') === acct && +r.MobileLines > 0 && r.OrderDate === date;
    });
    if (same.length) return { ok: false, confirm: 'Ya hay ' + same[0].MobileLines + ' línea(s) en esta cuenta con fecha ' + date +
      ' (' + (same[0].SoldBy || same[0].Employee || same[0].RepID || '—') + '). ¿Es otra orden distinta?' };
  }
  var rec = {};
  ACT_EDITABLE.forEach(function (k) { if (d[k] !== undefined && d[k] !== null) rec[k] = d[k]; });
  rec.AccountNumber = acct; rec.OrderDate = date; rec.MobileOrder = order;
  rec.SoldBy = String(d.SoldBy || who);
  if (!lines) { rec.MobileLines = ''; rec.MobileType = ''; }
  var saved = actSave_(rec, { Source: 'Manual', EnteredBy: who });
  var prior = lines ? actPriorMobile_(rows, acct, date, '') : [];
  var warning = '';
  if (lines && prior.length && type && type !== 'Incremental') warning = 'Esta cuenta ya tenía línea(s) nuestra(s) (' + prior[prior.length - 1].OrderDate + '): normalmente es Incremental.';
  if (lines && !prior.length && type === 'Incremental') warning = 'No hay una línea anterior nuestra en esta cuenta: revisa si de verdad es Incremental.';
  return { ok: true, line: saved, warning: warning };
}

// ─── Unir la línea al registro de la misma orden ───────────────────
// Registro candidato: misma cuenta, fecha a ±3 días, con internet o TV y sin líneas móviles propias.
function lineMergeTarget_(acct, date, excludeId) {
  if (String(acct).length < 9 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  var rows = actReadAll_(actSheet_()).rows;
  var c = rows.filter(function (r) {
    if (r.ID === excludeId) return false;
    if (String(r.AccountNumber || '').replace(/\D/g, '') !== acct) return false;
    if (!(r.InternetTier || r.VideoTier) || +r.MobileLines > 0) return false;
    var od = String(r.OrderDate || '').slice(0, 10);
    return od && Math.abs(actDayDiff_(od, date)) <= LINE_MERGE_DAYS;
  });
  c.sort(function (a, b) { return Math.abs(actDayDiff_(a.OrderDate, date)) - Math.abs(actDayDiff_(b.OrderDate, date)); });
  return c[0] || null;
}
function lineFindById_(id) {
  return actReadAll_(actSheet_()).rows.filter(function (r) { return r.ID === id; })[0] || null;
}
function lineAskMerge_(t) {
  return { ok: false, merge: { id: t.ID, name: t.CustomerName || '', date: t.OrderDate || '', source: t.Source || '',
    internet: t.InternetTier || '', tv: t.VideoTier || '' } };
}
function lineMerge_(t, d, soldBy, rep) {
  if (+t.MobileLines > 0) throw new Error('Ese registro ya tiene líneas. Registra esta como orden nueva.');
  var lines = Math.floor(+d.MobileLines || 0);
  if (!(lines >= 1 && lines <= 10)) throw new Error('Líneas: escribe un número del 1 al 10.');
  if (ACT_MOBILE_TYPES.indexOf(String(d.MobileType || '')) < 0) throw new Error('Escoge si es primera línea, incremental o adicional.');
  if (rep) {   // asesora: solo órdenes de los últimos 7 días (o la de una venta de caja)
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (actDayDiff_(String(t.OrderDate).slice(0, 10), today) > 7 + LINE_MERGE_DAYS && !(typeof cajaVentaValida_ === 'function' && cajaVentaValida_(rep, d)))
      throw new Error('Esa orden es de hace más de 7 días. Avísale a Joel.');
  }
  var join = function (a, b, sep) { return [String(a || '').trim(), String(b || '').trim()].filter(Boolean).join(sep); };
  var order = String(d.MobileOrder || '').replace(/\D/g, '');
  var upd = {
    ID: t.ID, MobileLines: String(lines), MobileType: d.MobileType, MobilePlan: d.MobilePlan || t.MobilePlan || '',
    MobileOrder: join(t.MobileOrder, order, ','), LinePhones: join(t.LinePhones, d.LinePhones, ', '),
    IMEIs: join(t.IMEIs, d.IMEIs, ', '), Notes: join(t.Notes, d.Notes, ' · '),
    SoldBy: t.SoldBy || soldBy, Phone: t.Phone || String(d.Phone || '').replace(/\D/g, '')
  };
  if (d.PosSaleID && !t.PosSaleID) upd.PosSaleID = String(d.PosSaleID);
  if (d.RepID && !t.RepID) upd.RepID = String(d.RepID).toUpperCase();
  return { ok: true, merged: true, line: actSave_(upd) };
}
