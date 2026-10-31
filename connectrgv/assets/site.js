/* ConnectRGV — interacciones del sitio */
(function () {
  // Pega aquí la URL de tu Apps Script ("Implementar > Aplicación web").
  // Mientras esté vacía, los formularios abren un correo a EMAIL como respaldo.
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxqbu5EMlw3wmq6zEywKCEPJ3_yejlNfKrsMqcuGcU0P2RCHjjPFKhEOzK3f8Ivqw_JNQ/exec';
  var EMAIL = 'mircommllc@gmail.com';
  // Idioma de la página (las páginas en inglés tienen <html lang="en">; las de socio lo cambian al vuelo)
  function EN() { return /^en/i.test(document.documentElement.lang || ''); }

  /* Botón Español / English: recuerda lo que escogió el cliente para las demás páginas */
  document.querySelectorAll('.lang-sw a[data-lang]').forEach(function (a) {
    a.addEventListener('click', function () {
      try { localStorage.setItem('cgv_lang', a.getAttribute('data-lang')); localStorage.setItem('cgv_guia_l', a.getAttribute('data-lang')); } catch (e) {}
    });
  });

  /* Menú en celular */
  var nav = document.querySelector('.nav-links');
  document.querySelectorAll('.menu-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = nav && nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
  if (nav) nav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      nav.classList.remove('open');
      document.querySelectorAll('.menu-btn').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    });
  });

  /* Opciones de "¿Cuándo te mudas?" y "Necesito" */
  var BASE = 'min-height: 44px; padding: 0 15px; border-radius: 999px; font: inherit; font-size: 15px; cursor: pointer; ';
  var ON = 'border: 1px solid #111312; background: #111312; color: #FFFFFF';
  var OFF = 'border: 1px solid #D4D1CA; background: #FFFFFF; color: #111312';
  function paint(btn) { btn.setAttribute('style', BASE + (btn.getAttribute('aria-pressed') === 'true' ? ON : OFF)); }
  document.querySelectorAll('[data-chip]').forEach(function (btn) {
    paint(btn);
    btn.addEventListener('click', function () {
      var group = btn.getAttribute('data-chip');
      if (btn.hasAttribute('data-multi')) {
        btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        paint(btn);
      } else {
        document.querySelectorAll('[data-chip="' + group + '"]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); paint(b); });
        btn.setAttribute('aria-pressed', 'true'); paint(btn);
        var note = document.getElementById('when-note');
        if (note && btn.getAttribute('data-note')) note.textContent = btn.getAttribute('data-note');
      }
    });
  });
  function picked(group) {
    return Array.prototype.map.call(document.querySelectorAll('[data-chip="' + group + '"][aria-pressed="true"]'), function (b) { return (b.getAttribute('data-v') || b.textContent).trim(); }).join(', ');
  }

  /* Envío */
  function send(data, done) {
    data.pagina = location.pathname;
    data.fecha_envio = new Date().toLocaleString('es-MX');
    if (!ENDPOINT) {
      var body = Object.keys(data).map(function (k) { return k + ': ' + data[k]; }).join('\n');
      location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('ConnectRGV — ' + data.tipo) + '&body=' + encodeURIComponent(body);
      done(); return;
    }
    fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', body: new URLSearchParams(data) }).then(done, done);
  }
  function collect(form) {
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });
    return data;
  }
  function showOk(form) {
    form.hidden = true;
    var ok = form.parentNode.querySelector('[data-ok]');
    if (ok) { ok.hidden = false; ok.focus && ok.focus(); }
  }
  document.querySelectorAll('[data-reset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var box = btn.closest('[data-ok]'); box.hidden = true;
      var form = box.parentNode.querySelector('form'); form.hidden = false; form.reset();
    });
  });

  /* Dirección: obligatoria, desglosada y con vista previa */
  var MSG = {
    calle: 'Escribe el número de casa y la calle. Ej.: 1234 N. 10th St.',
    ciudad: 'Escribe la ciudad. Ej.: McAllen.',
    codigo_postal: 'Escribe los 5 números del código postal. Ej.: 78504.',
    direccion_confirmada: 'Revisa tu dirección y marca la casilla para confirmar.'
  };
  var MSG_EN = {
    calle: 'Enter the house number and street. e.g. 1234 N. 10th St.',
    ciudad: 'Enter the city. e.g. McAllen.',
    codigo_postal: 'Enter the 5-digit ZIP code. e.g. 78504.',
    direccion_confirmada: 'Check your address and tick the box to confirm.'
  };
  var PREVIEW = 'Escribe tu dirección arriba.', PREVIEW_EN = 'Enter your address above.';
  function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
  function fullAddress(box) {
    var g = function (n) { var el = box.querySelector('[name=' + n + ']'); return el ? clean(el.value) : ''; };
    var calle = g('calle'), depto = g('depto'), ciudad = g('ciudad'), zip = g('codigo_postal');
    if (depto && !/^(#|apt|depto|unit|lot|lote|ste|suite)/i.test(depto)) depto = (EN() ? 'Apt. ' : 'Depto. ') + depto;
    var line = [calle, depto].filter(Boolean).join(', ');
    var tail = [ciudad, ciudad || zip ? 'TX' : '', zip].filter(Boolean).join(' ').replace(' TX', ', TX');
    return [line, tail].filter(Boolean).join(', ');
  }
  document.querySelectorAll('[data-address]').forEach(function (box) {
    var preview = box.querySelector('[data-addr-preview]');
    var warn = box.querySelector('[data-zip-warn]');
    var check = box.querySelector('[name=direccion_confirmada]');
    function update(e) {
      var txt = fullAddress(box);
      preview.textContent = txt || (EN() ? PREVIEW_EN : PREVIEW);
      var zip = clean((box.querySelector('[name=codigo_postal]') || {}).value);
      if (warn) warn.hidden = !(zip.length === 5 && !/^785/.test(zip));
      // Si cambian la dirección después de confirmarla, se vuelve a pedir la confirmación
      if (e && e.target !== check && check && check.checked) check.checked = false;
    }
    box.querySelectorAll('input').forEach(function (inp) {
      var n = inp.getAttribute('name');
      inp.addEventListener('input', function (e) { inp.setCustomValidity(''); update(e); });
      inp.addEventListener('change', function (e) { inp.setCustomValidity(''); update(e); });
      inp.addEventListener('invalid', function () { var M = EN() ? MSG_EN : MSG; if (M[n]) inp.setCustomValidity(M[n]); });
    });
    var zipIn = box.querySelector('[name=codigo_postal]');
    if (zipIn) zipIn.addEventListener('input', function () { zipIn.value = zipIn.value.replace(/\D/g, '').slice(0, 5); });
    box.__update = update;
    update();
  });

  /* Inicio: barra "Arma tu plan" -> pide nombre, teléfono y dirección */
  var plan = document.getElementById('plan-form');
  var dialog = document.getElementById('plan-dialog');
  if (plan && dialog) {
    plan.addEventListener('submit', function (e) {
      e.preventDefault();
      var barZip = plan.querySelector('[name=zip]');
      var dZip = dialog.querySelector('[name=codigo_postal]');
      if (barZip && dZip && !dZip.value) dZip.value = barZip.value.replace(/\D/g, '').slice(0, 5);
      var box = dialog.querySelector('[data-address]'); if (box && box.__update) box.__update();
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      var first = dialog.querySelector('input'); if (first) first.focus();
    });
    dialog.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { dialog.close ? dialog.close() : dialog.removeAttribute('open'); });
    });
  }

  document.querySelectorAll('form[data-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = collect(form);
      data.tipo = form.getAttribute('data-form');
      var addr = form.querySelector('[data-address]');
      if (addr) {
        data.direccion = fullAddress(addr);
        delete data.calle; delete data.depto; delete data.ciudad; delete data.direccion_confirmada;
      }
      if (data.tipo === 'familia' && plan) {
        if (!data.codigo_postal) { var z = plan.querySelector('[name=zip]'); data.codigo_postal = z ? z.value : ''; }
        data.cuando = picked('when');
        data.servicios = picked('need');
      }
      // Para saber en qué idioma llamarle
      if (EN() && data.tipo !== 'socio') data.servicios = (data.servicios ? data.servicios + ' ' : '') + '(habla inglés)';
      var socio = document.body.getAttribute('data-socio');
      if (socio) data.socio = socio;
      var btn = form.querySelector('[type=submit]');
      if (btn) { btn.disabled = true; btn.textContent = EN() ? 'Sending…' : 'Enviando…'; }
      send(data, function () { showOk(form); });
    });
  });
})();
