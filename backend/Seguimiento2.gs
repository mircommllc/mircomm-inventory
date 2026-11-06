/**
 * Seguimiento2.gs — segunda parte de Seguimiento.gs (Internet sin línea y órdenes que Spectrum no terminó).
 * Va en un archivo aparte solo para que se pueda pegar completo. Apps Script los junta solo.
 */
// ─── CLIENTES CON INTERNET SIN LÍNEA ───────────────────────────────
// Lee la hoja Activations (Activaciones.gs): cuentas con internet de los últimos SEG_SL_DIAS días
// que no tienen ninguna línea móvil registrada. Las asesoras las ven para ofrecerles la línea.
function segSinLinea_(me) {
  if (typeof actReadAll_ !== 'function' || typeof actSheet_ !== 'function') return [];
  var rows;
  try { rows = actReadAll_(actSheet_()).rows; } catch (e) { return []; }
  var cut = Utilities.formatDate(new Date(Date.now() - SEG_SL_DIAS * 86400000), segTz_(), 'yyyy-MM-dd');
  var groups = {}, telConLinea = {};
  rows.forEach(function (r) {
    var acct = String(r.AccountNumber || '').replace(/\D/g, ''), tel = String(r.Phone || '').replace(/\D/g, '').slice(-10);
    var key = acct || (tel ? 'T' + tel : '');
    if (!key) return;
    var g = groups[key] = groups[key] || { cuenta: key, int: null, mob: false };
    // Línea del paquete del correo ("Internet + 1 Mobile Line"): no cuenta como línea hasta que se registre o se active
    var pkg = r.Source === 'Email' && !r.MobileOrder && !String(r.IMEIs || '').trim() && !r.LinePhones && !r.MobileType;
    if (+r.MobileLines > 0) {
      if (pkg) g.pkg = true;
      else {
        g.mob = true;
        // El mismo cliente (mismo teléfono) ya tiene línea nuestra, aunque sea en otra cuenta (ej. se cambió de casa)
        if (tel.length === 10) telConLinea[tel] = 1;
        String(r.LinePhones || '').split(/[,;\/]+/).forEach(function (x) { x = x.replace(/\D/g, '').slice(-10); if (x.length === 10) telConLinea[x] = 1; });
      }
    }
    if (r.InternetTier && (!g.int || String(r.OrderDate) < String(g.int.OrderDate))) g.int = r;
  });
  var marks = {};
  segRead_(SEG_SL_SHEET, SEG_SL_HEADERS).rows.forEach(function (m) { marks[m.Cuenta] = m; });
  var out = [];
  Object.keys(groups).forEach(function (k) {
    var g = groups[k], r = g.int;
    if (!r || g.mob || String(r.OrderDate).slice(0, 10) < cut) return;
    if (telConLinea[String(r.Phone || '').replace(/\D/g, '').slice(-10)]) return;
    var m = marks[k];
    if (m && (m.Estado === 'Ya tiene línea' || m.Estado === 'No le interesa')) return;
    var o = { cuenta: k, nombre: r.CustomerName || '', telefono: String(r.Phone || '').replace(/\D/g, '').slice(-10),
      fecha: String(r.OrderDate).slice(0, 10), internet: r.InternetTier || '', paquete: !!g.pkg, estado: m ? m.Estado : '', nota: m ? m.Nota : '',
      por: m ? m.Por : '', marcado: m ? m.Fecha : '' };
    // Detalle de la cuenta (para buscarla en Spectrum): sale del correo de confirmación de la orden
    var prods = [];
    try { prods = JSON.parse(r.Products || '[]').map(function (x) { return x.name + (+x.qty > 1 ? ' ×' + x.qty : ''); }); } catch (e) {}
    o.cuentaNum = k.charAt(0) === 'T' ? '' : k;
    o.direccion = [r.Address, r.City, r.State, r.Zip].filter(String).join(', ');
    o.email = r.Email || ''; o.paqueteNombre = r.Package || ''; o.confirmacion = r.Confirmation || '';
    o.workOrder = r.WorkOrder || ''; o.instalacion = r.InstallType || ''; o.productos = prods; o.origen = r.Source || '';
    if (me.manager) { o.vendio = r.SoldBy || r.Employee || ''; o.repId = r.RepID || ''; o.total = r.OrderTotal || ''; }
    out.push(o);
  });
  return out.sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
}
function segSinLineaMark_(me, p) {
  var cuenta = String(p.cuenta || '');
  var estados = ['Contactado', 'Ya tiene línea', 'No le interesa', ''];
  if (!cuenta || estados.indexOf(p.estado) < 0) throw new Error('Datos incompletos.');
  var t = segRead_(SEG_SL_SHEET, SEG_SL_HEADERS);
  var m = t.rows.filter(function (x) { return x.Cuenta === cuenta; })[0] || { Cuenta: cuenta };
  m.Estado = p.estado; m.Nota = String(p.nota || '').slice(0, 200); m.Por = me.name; m.Fecha = segNow_();
  segWrite_(t, m);
  return { ok: true };
}

// Al subir el Mobile Report en Activaciones: las cuentas con línea activada salen de la lista.
function segSinLineaSync_(me, p) {
  if (!me.manager) throw new Error('Solo el manager.');
  var cuentas = String(p.cuentas || '').split(',').map(function (c) { return c.replace(/\D/g, ''); }).filter(String);
  var t = segRead_(SEG_SL_SHEET, SEG_SL_HEADERS), have = {}, n = 0;
  t.rows.forEach(function (m) { have[m.Cuenta] = m; });
  cuentas.forEach(function (c) {
    var m = have[c];
    if (m && (m.Estado === 'Ya tiene línea' || m.Estado === 'No le interesa')) return;
    m = m || { Cuenta: c };
    m.Estado = 'Ya tiene línea'; m.Nota = 'Activada en el Mobile Report'; m.Por = 'Mobile Report'; m.Fecha = segNow_();
    segWrite_(t, m); n++;
  });
  return { ok: true, marcadas: n };
}


// ─── ÓRDENES QUE SPECTRUM NO TERMINÓ ("Please Complete The Order") ───────────
// Spectrum manda ese correo cuando la orden no se pudo cerrar en el sistema (pago rechazado o tarjeta mal escrita,
// el cliente quedó marcado para verificación, ya hay una cuenta activa en la dirección…) y hay que llamar al 1-855-392-9910.
// Esas órdenes NO mandan el correo de confirmación, así que no entran solas a Activaciones.
var SEG_INC_SHEET = 'Seg_Incompletas';
var SEG_INC_HEADERS = ['Orden', 'Estado', 'Motivo', 'NuevaOrden', 'Nota', 'Por', 'Fecha', 'Avisado'];
var SEG_INC_DIAS = 30;
var SEG_INC_QUERY = 'from:MyAccount@spectrumemails.com subject:"Please Complete The Order"';

function segIncText_(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&amp;/g, '&').replace(/&#\d+;|&#x[0-9a-f]+;/gi, '-').replace(/\s+/g, ' ');
}
function segIncParse_(msg) {
  var t = segIncText_(msg.getBody());
  var g = function (re) { var m = t.match(re); return m ? m[1].trim() : ''; };
  return {
    orden: g(/Order#:\s*(\d+)/i), msgId: msg.getId(),
    fecha: Utilities.formatDate(msg.getDate(), segTz_(), 'yyyy-MM-dd HH:mm'),
    nombre: g(/Customer Name:\s*(.+?)\s*(?:\*\s*Note|Address:)/i),
    direccion: g(/Address:\s*(.+?)\s*Customer Phone/i),
    telefono: g(/Customer Phone:\s*([()\d\s.\-]+)/i).replace(/\D/g, '').slice(-10),
    paquete: g(/SERVICES\s*(.+?)\s*\|?\s*Order Total/i).replace(/\|/g, '').trim(),
    total: g(/Order Total\s*-\s*\$\s*([\d.,]+)/i)
  };
}
// Lista de los últimos 30 días con su estado (se guarda 5 minutos en caché para no leer Gmail en cada carga)
function segIncompletas_() {
  var cache = CacheService.getScriptCache(), raw = cache.get('seg_inc_v1'), list;
  if (raw) list = JSON.parse(raw);
  else {
    list = [];
    try {
      GmailApp.search(SEG_INC_QUERY + ' newer_than:' + SEG_INC_DIAS + 'd', 0, 60).forEach(function (th) {
        th.getMessages().forEach(function (m) {
          if (!/Please Complete The Order/i.test(m.getSubject())) return;
          var o = segIncParse_(m); if (o.orden) list.push(o);
        });
      });
    } catch (e) { return []; }
    cache.put('seg_inc_v1', JSON.stringify(list), 300);
  }
  // ¿Ya se completó? Misma confirmación en Activaciones, o una orden en la misma dirección / teléfono en los 10 días siguientes
  var acts = [];
  try { if (typeof actReadAll_ === 'function') acts = actReadAll_(actSheet_()).rows; } catch (e) {}
  var addrKey = function (a) { var m = String(a || '').toLowerCase().match(/^\s*(\d+)\s+([a-z0-9]+(?:\s+[a-z0-9]+)?)/); return m ? m[1] + ' ' + m[2] : ''; };
  var marks = {};
  segRead_(SEG_INC_SHEET, SEG_INC_HEADERS).rows.forEach(function (m) { marks[m.Orden] = m; });
  return list.map(function (o) {
    var d = o.fecha.slice(0, 10), ak = addrKey(o.direccion), hit = null;
    acts.forEach(function (r) {
      if (hit) return;
      var rd = String(r.OrderDate || '').slice(0, 10);
      if (String(r.Confirmation) === o.orden) { hit = r; return; }
      var dd = rd && d ? (new Date(rd + 'T12:00:00') - new Date(d + 'T12:00:00')) / 86400000 : 99;
      if (dd < -1 || dd > 10) return;
      var tel = String(r.Phone || '').replace(/\D/g, '').slice(-10);
      if ((o.telefono && tel === o.telefono) || (ak && addrKey(r.Address) === ak)) hit = r;
    });
    var m = marks[o.orden];
    o.estado = (m && m.Estado) || (hit ? 'Completada' : '');
    o.motivo = m ? m.Motivo : ''; o.nota = m ? m.Nota : ''; o.por = m ? m.Por : ''; o.marcado = m ? m.Fecha : '';
    o.nuevaOrden = m ? m.NuevaOrden : '';
    if (hit) { o.registrada = { nombre: hit.CustomerName || '', confirmacion: hit.Confirmation || '', fecha: String(hit.OrderDate || '').slice(0, 10) }; }
    return o;
  }).sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
}
function segIncMark_(me, p) {
  var estados = ['Completada por teléfono', 'Se hizo una orden nueva', 'Cancelada', ''];
  if (!p.orden || estados.indexOf(p.estado) < 0) throw new Error('Datos incompletos.');
  var t = segRead_(SEG_INC_SHEET, SEG_INC_HEADERS);
  var m = t.rows.filter(function (x) { return x.Orden === String(p.orden); })[0] || { Orden: String(p.orden) };
  m.Estado = p.estado; m.Motivo = String(p.motivo || '').slice(0, 80); m.NuevaOrden = String(p.nueva || '').replace(/\D/g, '').slice(0, 20);
  m.Nota = String(p.nota || '').slice(0, 300); m.Por = me.name; m.Fecha = segNow_();
  segWrite_(t, m);
  return { ok: true };
}
// Cada 15 min (desde segRevisar): aviso por correo al equipo de cada orden nueva que Spectrum no terminó
function segAvisarIncompletas_() {
  var list = segIncompletas_().filter(function (o) { return !o.estado; });
  if (!list.length) return;
  var t = segRead_(SEG_INC_SHEET, SEG_INC_HEADERS), have = {};
  t.rows.forEach(function (m) { have[m.Orden] = m; });
  var nuevas = list.filter(function (o) { return !(have[o.orden] && have[o.orden].Avisado); });
  if (!nuevas.length) return;
  var correos = segCorreos_(), to = Object.keys(correos).map(function (k) { return correos[k]; }).filter(String).join(',');
  if (!to) return;
  segMail_(to, '⚠️ Spectrum no terminó ' + (nuevas.length === 1 ? 'la orden de ' + nuevas[0].nombre : nuevas.length + ' órdenes'),
    '<p><b>Spectrum no cerró ' + (nuevas.length === 1 ? 'esta orden' : 'estas órdenes') + '.</b> Hay que llamar al <b>1-855-392-9910</b>, de preferencia con el cliente todavía en la tienda.</p>' +
    nuevas.map(function (o) {
      return '<p>• <b>' + segEsc_(o.nombre) + '</b> · orden #' + segEsc_(o.orden) + ' · ' + segEsc_(o.fecha) + '<br>' + segEsc_(o.direccion) +
        (o.telefono ? ' · (' + o.telefono.slice(0, 3) + ') ' + o.telefono.slice(3, 6) + '-' + o.telefono.slice(6) : '') + '<br>' + segEsc_(o.paquete) + (o.total ? ' · $' + segEsc_(o.total) : '') + '</p>';
    }).join('') +
    '<p>Qué revisar: el pago (tarjeta bien escrita, vencimiento y código postal de la tarjeta), si Spectrum pide verificar al cliente, o si ya hay una cuenta activa en la dirección. ' +
    'No se vuelve a meter la orden con datos de otra persona. Cuando quede, márcala en la app (Prospectos → Órdenes que Spectrum no terminó).</p>');
  nuevas.forEach(function (o) { var m = have[o.orden] || { Orden: o.orden }; m.Avisado = segNow_(); segWrite_(t, m); });
}
