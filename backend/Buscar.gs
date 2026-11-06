/**
 * Buscar.gs — 🔍 Búsqueda global del Hub (Ctrl K) · v64 · Fase 2
 * -----------------------------------------------------------------------------
 * getSearchIndex regresa una lista compacta de TODO lo que se puede buscar:
 * Customers, Prospects, Activations, Concierge y Contacts. El Hub la guarda unos minutos
 * y busca mientras escribes (sin esperar al servidor en cada letra).
 * Solo para administradores (pasa por authGate_ en Code.gs). Si una fuente falla, las demás siguen.
 * Se llama desde Code.gs → hubGet_(e), después de authGate_:   var bs = buscarRouter_(e); if (bs) return bs;
 */

function buscarRouter_(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'getSearchIndex') return null;
  var out;
  try {
    if (typeof isManagerToken_ === 'function' && !isManagerToken_(p.mt)) out = { error: 'La búsqueda es solo para administradores.', code: 'AUTH' };
    else out = buscarIndex_(p.store || 'palmhurst');
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function buscarIndex_(store) {
  var items = [], errors = {};
  var digits = function (v) { return String(v === null || v === undefined ? '' : v).replace(/\D/g, ''); };
  var add = function (t, id, title, sub, keys, date) {
    var ks = keys.filter(function (x) { return x !== '' && x !== null && x !== undefined; }).map(String);
    var nums = ks.map(digits).filter(function (n) { return n.length >= 3; });   // dígitos de cada campo por separado
    items.push({ t: t, id: String(id), ti: String(title || '').trim(), s: String(sub || '').trim(), d: String(date || '').slice(0, 10),
      k: (ks.join(' ').toLowerCase() + ' ' + nums.join(' ')).replace(/\s+/g, ' ').trim() });
  };
  var safe = function (name, fn) { try { fn(); } catch (err) { errors[name] = String((err && err.message) || err); } };

  safe('customers', function () {
    getCustomersList_(store).forEach(function (c) {
      var ph = digits(c.Phone).slice(-10);
      if (!ph) return;
      add('customer', ph, c.Name || ph, [c.Carrier, c.Email].filter(String).join(' · '), [c.Name, ph, c.Email], c.LastPurchase || '');
    });
  });
  safe('prospects', function () {
    prosReadAll_(prosSheet_()).rows.forEach(function (r) {
      if (!r.ID) return;
      add('prospect', r.ID, r.Nombre, [r.Estado || 'Activo', r.Asesora, r.Interes].filter(String).join(' · '),
        [r.Nombre, digits(r.Telefono), r.Direccion, r.CuentaSpectrum, r.Codigo, r.Asesora], r.Creado);
    });
  });
  safe('activations', function () {
    actReadAll_(actSheet_()).rows.forEach(function (r) {
      if (!r.ID) return;
      var svc = [r.InternetTier && 'Internet ' + r.InternetTier, +r.MobileLines > 0 && r.MobileLines + ' línea(s)', r.VideoTier && 'TV'].filter(Boolean).join(' + ');
      add('activation', r.ID, r.CustomerName || r.AccountNumber, [r.AccountNumber, svc].filter(String).join(' · '),
        [r.CustomerName, r.AccountNumber, digits(r.Phone), r.Confirmation, r.WorkOrder, r.MobileOrder, digits(r.LinePhones), r.Email, r.IMEIs], r.OrderDate);
    });
  });
  safe('concierge', function () {
    ['cliente', 'familia', 'socio'].forEach(function (tipo) {
      if (!CGV_TABS[tipo]) return;
      cgvRead_(tipo).forEach(function (r) {
        if (!r.id) return;
        add('concierge', r.id, r.nombre || r.empresa, [tipo === 'socio' ? 'Socio' : 'Mudanza', r.estatus, r.socio || r.empresa].filter(String).join(' · '),
          [r.nombre, r.empresa, digits(r.telefono), r.correo, r.direccion, r.socio], r.recibido);
      });
    });
  });
  safe('contacts', function () {
    escRead_(ESC_CONTACTS, ESC_CONTACT_HEADERS).rows.forEach(function (c) {
      if (!c.ID) return;
      add('contact', c.ID, c.Nombre, [c.Empresa, c.Correo].filter(String).join(' · '), [c.Nombre, c.Empresa, c.Correo, digits(c.Telefono), c.Uso], '');
    });
  });
  return { ok: true, items: items, errors: errors, generated: new Date().toISOString() };
}
