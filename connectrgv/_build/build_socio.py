"""Página de cliente de socio (connectrgv.com/<socio>): bilingüe (ES/EN) y con la redacción revisada.
Una sola página para /socio/, /ejemplo/ y /missionpm/ (la de Imelda trae sus datos de respaldo)."""
import re
s = open('socio/index.html', encoding='utf-8').read()

def R(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (a[:90], c)
    s = s.replace(a, b)

def I(text, key, n=1):
    """Envuelve un texto fijo para traducirlo: >texto< → ><span data-i="key">texto</span><"""
    R('>' + text + '<', '><span data-i="' + key + '">' + text + '</span><', n)

R('<html lang="es">', '<html lang="es" translate="no">')
R('<meta name="robots" content="noindex">', '<meta name="robots" content="noindex">\n<meta name="google" content="notranslate">')
# Botón de idioma en el encabezado (antes del teléfono)
R('<a class="phone-icon" href="tel:+19564676695"',
  '<button type="button" class="lang-btn" data-lang-toggle="" style="min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid #D4D1CA; background: #FFFFFF; color: #111312; font-size: 14px; cursor: pointer; margin-left: auto">English</button>\n<a class="phone-icon" href="tel:+19564676695"')

# Textos fijos
I('Tu concierge de mudanza', 'eyebrowGen')
R('<p data-s="intro" style="margin: 32px 0 0; max-width: 500px; font-size: 19px; line-height: 1.55; color: #3A403D">Te atendemos personalmente. Dejamos internet, luz y celular listos para el día que llegas, y a ti no te cuesta nada.</p>',
  '<p data-s="intro" style="margin: 32px 0 0; max-width: 500px; font-size: 19px; line-height: 1.55; color: #3A403D"></p>')
for t, k in [('Tu nombre', 'fNombre'), ('Teléfono', 'fTel'), ('Fecha de mudanza', 'fFecha'), ('Dirección de la casa nueva', 'fDirH'),
             ('Con ella revisamos qué servicios llegan a tu casa. Escríbela completa, por favor.', 'fDirP'), ('Número y calle', 'fCalle'),
             ('Depto., unidad o lote', 'fDepto'), ('Ciudad', 'fCiudad'), ('Código postal', 'fZip'),
             ('Ese código postal no es del Valle. Revísalo, por favor.', 'fZipWarn'), ('Así la tenemos', 'fAsi'),
             ('Te llamamos hoy mismo, en español o inglés.', 'fLlamamos'), ('Que me llamen hoy', 'fBoton'), ('Listo', 'okH'),
             ('Te llamamos hoy para armar tu Plan de Mudanza.', 'okP'), ('Corregir mis datos', 'okReset'),
             ('Lo que hacemos por ti, de principio a fin.', 'pasosH')]:
    I(t, k)
R('Confirmo que la dirección está completa y correcta.</label>', '<span data-i="fConfirmo">Confirmo que la dirección está completa y correcta.</span></label>')
# Los tres pasos (redacción corregida)
R('<h3 style="margin: 14px 0 0; font-size: 20px; font-weight: 600">Revisamos tu dirección</h3><p style="margin: 8px 0 0; color: #4A504D">Te decimos qué internet y qué compañías de luz llegan de verdad a tu casa.</p>',
  '<h3 style="margin: 14px 0 0; font-size: 20px; font-weight: 600" data-i="p1H">Revisamos tu dirección</h3><p style="margin: 8px 0 0; color: #4A504D" data-i="p1P">Te decimos qué compañías de internet y de luz dan servicio en tu casa.</p>')
R('<h3 style="margin: 14px 0 0; font-size: 20px; font-weight: 600">Contratamos y confirmamos</h3><p style="margin: 8px 0 0; color: #4A504D">Precio por escrito antes de firmar y cada cita confirmada, con recordatorio.</p>',
  '<h3 style="margin: 14px 0 0; font-size: 20px; font-weight: 600" data-i="p2H">Hacemos los contratos por ti</h3><p style="margin: 8px 0 0; color: #4A504D" data-i="p2P">Te damos el precio por escrito antes de que firmes y confirmamos cada cita de instalación, con recordatorio.</p>')
R('<h3 style="margin: 14px 0 0; font-size: 20px; font-weight: 600">Te guiamos con lo demás</h3><p style="margin: 8px 0 0; color: #4A504D">Agua y basura de la ciudad, exención homestead y cambio de domicilio.</p>',
  '<h3 style="margin: 14px 0 0; font-size: 20px; font-weight: 600" data-i="p3H">Te ayudamos con lo demás</h3><p style="margin: 8px 0 0; color: #4A504D"><span data-i="p3P">Agua y basura de la ciudad, exención homestead y cambio de domicilio, con nuestra</span> <a data-guia="" href="/guia/" style="color: #111312"><span data-i="p3Link">guía gratis de mudanza</span></a>.</p>')
R('Con el respaldo de<br><span data-s="quien"></span>', '<span data-i="respaldo">Con el respaldo de</span><br><span data-s="quien"></span>')
R('<span data-s="dudas"></span> ¿Dudas sobre internet, luz o celular? Llámanos al <a href="tel:+19564676695" style="color: #111312">(956) 467-6695</a>.',
  '<span data-s="dudas"></span> <span data-i="dudasNos">¿Dudas sobre internet, luz o celular? Llámanos al</span> <a href="tel:+19564676695" style="color: #111312">(956) 467-6695</a>.')
R('<span data-s="divulgacion"></span>Servicios de internet a través de MirComm, retailer autorizado. © 2026 ConnectRGV.',
  '<span data-s="divulgacion"></span><span data-i="pie">Servicios de internet a través de MirComm, retailer autorizado.</span> © 2026 ConnectRGV.')

# ── Script: datos del socio + idioma ──
start = s.index('<script>\n/* Página de socio')
end = s.index('</script>', start) + len('</script>')
JS = r'''<script>
/* Página de socio: connectrgv.com/<nombre> → los datos del socio vienen de la hoja (pestaña Directorio, Publicada = Sí).
   Se arma desde el Hub (🧰 Página y kit). Esta misma página sirve para todos los socios, en español o inglés. */
(function () {
  var DATOS = 'https://script.google.com/macros/s/AKfycbxqbu5EMlw3wmq6zEywKCEPJ3_yejlNfKrsMqcuGcU0P2RCHjjPFKhEOzK3f8Ivqw_JNQ/exec';
  // Datos de respaldo si la hoja no contesta (páginas que ya están impresas) y la página de muestra
  var FIJOS = {
    missionpm: { ok: true, clave: 'Imelda Gonzalez · Mission Property Management', nombre: 'Imelda Gonzalez', empresa: 'Mission Property Management' },
    ejemplo: { ok: true, muestra: true, clave: '', nombre: '[Tu nombre]', empresa: '[Tu agencia]', nombreEn: '[Your name]', empresaEn: '[Your brokerage]' }
  };
  var TXT = {
    es: {
      eyebrowGen: 'Tu concierge de mudanza', fNombre: 'Tu nombre', fTel: 'Teléfono', fFecha: 'Fecha de mudanza', fDirH: 'Dirección de la casa nueva',
      fDirP: 'Con ella revisamos qué servicios llegan a tu casa. Escríbela completa, por favor.', fCalle: 'Número y calle', fDepto: 'Depto., unidad o lote',
      fCiudad: 'Ciudad', fZip: 'Código postal', fZipWarn: 'Ese código postal no es del Valle. Revísalo, por favor.', fAsi: 'Así la tenemos',
      fConfirmo: 'Confirmo que la dirección está completa y correcta.', fLlamamos: 'Te llamamos hoy mismo, en español o inglés.', fBoton: 'Que me llamen hoy',
      okH: 'Listo', okP: 'Te llamamos hoy para armar tu Plan de Mudanza.', okReset: 'Corregir mis datos', pasosH: 'Lo que hacemos por ti, de principio a fin.',
      p1H: 'Revisamos tu dirección', p1P: 'Te decimos qué compañías de internet y de luz dan servicio en tu casa.',
      p2H: 'Hacemos los contratos por ti', p2P: 'Te damos el precio por escrito antes de que firmes y confirmamos cada cita de instalación, con recordatorio.',
      p3H: 'Te ayudamos con lo demás', p3P: 'Agua y basura de la ciudad, exención homestead y cambio de domicilio, con nuestra', p3Link: 'guía gratis de mudanza',
      respaldo: 'Con el respaldo de', dudasNos: '¿Dudas sobre internet, luz o celular? Llámanos al', pie: 'Servicios de internet a través de MirComm, retailer autorizado.',
      ph: { calle: 'Ej. 1234 N. 10th St.', depto: 'Si aplica', ciudad: 'Ej. McAllen' }, preview: 'Escribe tu dirección arriba.', enviando: 'Enviando…',
      introGen: 'Te atendemos personalmente. Te dejamos internet, luz y celular listos para el día que llegues, y a ti no te cuesta nada.',
      intro: function (n, e) { return (e ? n + ', de ' + e + ', nos pidió' : n + ' nos pidió') + ' que te atendiéramos personalmente. Te dejamos internet, luz y celular listos para el día que llegues, y a ti no te cuesta nada.'; },
      regalo: 'Un regalo de', ok: function (n) { return 'Le avisaremos a ' + n + ' que ya estás en buenas manos.'; },
      alianza: function (q) { return q + ' trabaja con nosotros para que llegues a una casa que ya funciona.'; },
      dudas: function (n) { return '¿Dudas sobre tu casa o tu contrato? Sigue con ' + n + '.'; },
      divulga: function (q) { return q + ' puede recibir una compensación por recomendar este servicio. '; },
      titulo: function (q) { return 'Bienvenido a tu nueva casa · ' + (q ? q + ' y ' : '') + 'ConnectRGV'; }, h1: 'Bienvenido a tu nueva casa.',
      alt: 'Entrada de una casa del Valle con la puerta de madera abierta, luz de tarde y sombra de palma', otro: 'English',
      msg: { calle: 'Escribe el número de casa y la calle. Ej.: 1234 N. 10th St.', ciudad: 'Escribe la ciudad. Ej.: McAllen.', codigo_postal: 'Escribe los 5 números del código postal. Ej.: 78504.', direccion_confirmada: 'Revisa tu dirección y marca la casilla para confirmar.' }
    },
    en: {
      eyebrowGen: 'Your moving concierge', fNombre: 'Your name', fTel: 'Phone', fFecha: 'Move-in date', fDirH: 'Your new home address',
      fDirP: 'We use it to check which services are available at your home. Please enter the full address.', fCalle: 'Street number and name', fDepto: 'Apt., unit or lot',
      fCiudad: 'City', fZip: 'ZIP code', fZipWarn: 'That ZIP code is not in the Valley. Please check it.', fAsi: 'Here is what we have',
      fConfirmo: 'I confirm the address is complete and correct.', fLlamamos: 'We will call you today, in English or Spanish.', fBoton: 'Call me today',
      okH: 'Done', okP: 'We will call you today to put together your Moving Plan.', okReset: 'Fix my information', pasosH: 'What we do for you, start to finish.',
      p1H: 'We check your address', p1P: 'We tell you which internet and electricity providers serve your home.',
      p2H: 'We sign you up', p2P: 'You get the price in writing before you sign, and we confirm every installation appointment, with a reminder.',
      p3H: 'We help with the rest', p3P: 'City water and trash, the homestead exemption and your change of address, with our', p3Link: 'free moving guide',
      respaldo: 'Backed by', dudasNos: 'Questions about internet, electricity or phone? Call us at', pie: 'Internet service provided through MirComm, an authorized retailer.',
      ph: { calle: 'e.g. 1234 N. 10th St.', depto: 'If applicable', ciudad: 'e.g. McAllen' }, preview: 'Type your address above.', enviando: 'Sending…',
      introGen: 'We take care of you personally. We will have your internet, electricity and phone ready for move-in day, at no cost to you.',
      intro: function (n, e) { return n + (e ? ' from ' + e : '') + ' asked us to take care of you personally. We will have your internet, electricity and phone ready for move-in day, at no cost to you.'; },
      regalo: 'A gift from', ok: function (n) { return 'We will let ' + n + ' know you are in good hands.'; },
      alianza: function (q) { return q + ' works with us so you move into a home that is ready to go.'; },
      dudas: function (n) { return 'Questions about your home or your lease? Contact ' + n + '.'; },
      divulga: function (q) { return q + ' may receive compensation for referring this service. '; },
      titulo: function (q) { return 'Welcome to your new home · ' + (q ? q + ' and ' : '') + 'ConnectRGV'; }, h1: 'Welcome to your new home.',
      alt: 'Front door of a Valley home standing open, with afternoon light and the shadow of a palm tree', otro: 'Español',
      msg: { calle: 'Enter the house number and street. e.g. 1234 N. 10th St.', ciudad: 'Enter the city. e.g. McAllen.', codigo_postal: 'Enter the 5-digit ZIP code. e.g. 78504.', direccion_confirmada: 'Check your address and tick the box to confirm.' }
    }
  };
  var parts = location.pathname.split('/').filter(Boolean);
  var slug = (parts[0] || '').toLowerCase();
  if (slug === 'socio') slug = (new URLSearchParams(location.search).get('p') || '').toLowerCase();
  slug = slug.replace(/[^a-z0-9-]/g, '').slice(0, 40);
  var qL = new URLSearchParams(location.search).get('l');
  var L = qL === 'en' || qL === 'es' ? qL : '', datos = null, done = false;
  try { if (!L) L = localStorage.getItem('cgv_lang') || ''; } catch (e) {}
  var $ = function (k) { return document.querySelectorAll('[data-s="' + k + '"]'); };
  var set = function (k, t) { $(k).forEach(function (el) { el.textContent = t; }); };
  function lang() { return L === 'en' ? 'en' : 'es'; }
  function listo() { document.body.classList.remove('cargando'); }
  // Textos fijos, marcadores, mensajes del formulario
  function textos() {
    var T = TXT[lang()];
    document.documentElement.lang = lang();
    document.querySelectorAll('[data-i]').forEach(function (el) { var v = T[el.getAttribute('data-i')]; if (typeof v === 'string') el.textContent = v; });
    var h1 = document.querySelector('h1'); if (h1) h1.textContent = T.h1;
    Object.keys(T.ph).forEach(function (n) { var el = document.querySelector('[name="' + n + '"]'); if (el) el.setAttribute('placeholder', T.ph[n]); });
    var fig = document.querySelector('figure img'); if (fig) fig.alt = T.alt;
    var g = document.querySelector('[data-guia]'); if (g) g.href = '/guia/' + (lang() === 'en' ? '?l=en' : '');
    document.querySelectorAll('[data-lang-toggle]').forEach(function (b) { b.textContent = T.otro; b.setAttribute('lang', lang() === 'en' ? 'es' : 'en'); });
    var pv = document.querySelector('[data-addr-preview]');
    if (pv && (pv.textContent === TXT.es.preview || pv.textContent === TXT.en.preview)) pv.textContent = T.preview;
  }
  function generica() {
    done = true;
    var T = TXT[lang()];
    document.querySelectorAll('[data-solo-socio]').forEach(function (el) { el.hidden = true; });
    set('eyebrow', T.eyebrowGen); set('intro', T.introGen);
    document.title = T.titulo('');
    listo();
  }
  function pintar(d) {
    done = true; datos = d;
    var T = TXT[lang()], en = lang() === 'en' && d.muestra;
    var nom = String((en ? d.nombreEn : d.nombre) || '').trim(), emp = String((en ? d.empresaEn : d.empresa) || '').trim(), quien = emp || nom;
    if (!nom) return generica();
    if (d.clave) document.body.setAttribute('data-socio', d.clave); else document.body.removeAttribute('data-socio');
    var marca = $('marca')[0];
    marca.innerHTML = '';
    if (d.foto) {
      var img = document.createElement('img'); img.src = d.foto; img.alt = quien; img.className = 'socio-logo'; marca.appendChild(img);
    } else {
      var p = document.createElement('p');
      p.setAttribute('style', 'margin: 0; max-width: 130px; font-size: 12px; line-height: 1.25; font-weight: 600; letter-spacing: 0.02em; color: #111312');
      p.textContent = quien; marca.appendChild(p);
    }
    set('eyebrow', T.regalo + ' ' + nom + (emp ? ' · ' + emp : ''));
    set('intro', T.intro(nom, emp));
    set('ok', T.ok(nom));
    set('quien', quien);
    set('alianza-txt', T.alianza(quien));
    set('dudas', T.dudas(nom));
    set('divulgacion', T.divulga(quien));
    $('alianza')[0].setAttribute('aria-label', (lang() === 'en' ? 'Partnership with ' : 'Alianza con ') + quien);
    document.title = T.titulo(quien);
    document.querySelectorAll('[data-solo-socio]').forEach(function (el) { el.hidden = false; });
    listo();
  }
  function repintar() { textos(); if (datos) pintar(datos); else if (done) generica(); }
  // Botón English / Español
  document.querySelectorAll('[data-lang-toggle]').forEach(function (b) {
    b.addEventListener('click', function () { L = lang() === 'en' ? 'es' : 'en'; try { localStorage.setItem('cgv_lang', L); } catch (e) {} repintar(); });
  });
  // Mensajes del formulario en el idioma de la página (site.js los pone en español)
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-address] input').forEach(function (inp) {
      var n = inp.getAttribute('name');
      inp.addEventListener('invalid', function () { var m = TXT[lang()].msg[n]; if (m) inp.setCustomValidity(m); });
    });
    var pv = document.querySelector('[data-addr-preview]');
    var btn = document.querySelector('form [type=submit]');
    if (window.MutationObserver) {
      if (pv) new MutationObserver(function () { if (lang() === 'en' && pv.textContent === TXT.es.preview) pv.textContent = TXT.en.preview; }).observe(pv, { childList: true, characterData: true, subtree: true });
      if (btn) new MutationObserver(function () { if (lang() === 'en' && btn.textContent === TXT.es.enviando) btn.textContent = TXT.en.enviando; }).observe(btn, { childList: true, characterData: true, subtree: true });
    }
  });
  textos();
  var fijo = FIJOS[slug];
  if (!slug) return generica();
  if (fijo && fijo.muestra) return pintar(fijo);
  // Lo último que se vio de este socio sale al instante; luego se actualiza
  try { var c = JSON.parse(localStorage.getItem('cgv_socio_' + slug) || 'null'); if (c && c.ok) { if (!L && c.idioma === 'EN') L = 'en'; textos(); pintar(c); } } catch (e) {}
  setTimeout(function () { if (!done) { if (fijo) pintar(fijo); else generica(); } }, 4000);
  fetch(DATOS + '?p=' + encodeURIComponent(slug)).then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.ok) {
      if (!L && d.idioma === 'EN') { L = 'en'; textos(); }
      pintar(d); try { localStorage.setItem('cgv_socio_' + slug, JSON.stringify(d)); } catch (e) {}
    } else {
      try { localStorage.removeItem('cgv_socio_' + slug); } catch (e) {}
      if (fijo) pintar(fijo); else if (!done || !datos) generica();
    }
  }).catch(function () { if (!done) { if (fijo) pintar(fijo); else generica(); } });
})();
</script>'''
s = s[:start] + JS + s[end:]
open('socio/index.html', 'w', encoding='utf-8').write(s)
print('ok', len(s.encode()))
