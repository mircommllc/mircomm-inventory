# Genera la página de inicio en español (/) y en inglés (/en/) a partir de la copia exacta del sitio en vivo.
import re, sys
SRC = '/home/claude/home/live-index.html'
s0 = open(SRC, encoding='utf-8').read()

CSS = """.lang-sw{display:inline-flex;align-items:center;gap:2px;padding:3px;border:1px solid #D4D1CA;border-radius:999px;background:#FFFFFF}
.lang-sw a{min-height:38px;padding:0 14px;display:inline-flex;align-items:center;border-radius:999px;font-size:14px;font-weight:500;line-height:1;color:#111312;text-decoration:none;white-space:nowrap}
.lang-sw a[aria-current]{background:#111312;color:#FFFFFF}
.lang-sw .lg-s{display:none}
@media (max-width: 560px){.lang-sw a{padding:0 11px}.lang-sw .lg-l{display:none}.lang-sw .lg-s{display:inline}}
@media (max-width: 560px){header > div{column-gap:12px!important}header div:has(> .lang-sw){gap:6px!important}header svg[viewBox="0 0 507 120"]{width:128px;height:30px}.menu-btn,.phone-icon{min-width:40px!important}}
@media (max-width: 400px){.lang-sw a{padding:0 9px}header svg[viewBox="0 0 507 120"]{width:116px;height:28px}}
"""
def switch(cur):
    a = lambda code, href, long, short: ('<a href="%s" lang="%s" hreflang="%s" data-lang="%s"%s><span class="lg-l">%s</span><span class="lg-s" aria-hidden="true">%s</span></a>'
        % (href, code, code, code, ' aria-current="page"' if cur == code else '', long, short))
    return '<div class="lang-sw" role="group" aria-label="Idioma / Language">' + a('es', '/', 'Español', 'ES') + a('en', '/en/', 'English', 'EN') + '</div>\n'

def redirect(to_lang, to_path):
    # Si el cliente ya escogió el otro idioma antes, lo lleva directo a su versión (se puede cambiar con el botón).
    return ("<script>try{if(localStorage.getItem('cgv_lang')==='%s'&&!/[?&]l=/.test(location.search))location.replace('%s'+location.hash)}catch(e){}</script>\n"
            % (to_lang, to_path))

def common(s, lang):
    rep(s, '<html lang="es">', '<html lang="%s" translate="no">' % lang)
    s = S[0]
    s = s.replace('<link rel="canonical" href="https://connectrgv.com/">',
                  '<link rel="canonical" href="https://connectrgv.com/%s">\n<link rel="alternate" hreflang="es" href="https://connectrgv.com/">\n<link rel="alternate" hreflang="en" href="https://connectrgv.com/en/">\n<link rel="alternate" hreflang="x-default" href="https://connectrgv.com/">' % ('en/' if lang == 'en' else ''), 1)
    s = s.replace('<meta name="theme-color" content="#1E3A32">', '<meta name="theme-color" content="#1E3A32">\n<meta name="google" content="notranslate">\n' +
                  (redirect('es', '/') if lang == 'en' else redirect('en', '/en/')).rstrip('\n'), 1)
    s = s.replace('button:disabled{opacity:.6;cursor:default}', 'button:disabled{opacity:.6;cursor:default}\n' + CSS.rstrip('\n'), 1)
    # Botón de idioma siempre visible (también en celular), antes del menú
    marker = '<button class="menu-btn" type="button"'
    assert s.count(marker) == 1
    s = s.replace(marker, switch(lang) + marker, 1)
    return s

S = [None]
def rep(s, a, b, count=1):
    n = s.count(a)
    if n != count:
        sys.exit('No encontrado %dx (hay %d): %r' % (count, n, a[:80]))
    S[0] = s.replace(a, b)
    return S[0]

# ---------- Español ----------
es = common(s0, 'es')
es = rep(es, '<p style="margin: 0; font-size: 16px; line-height: 1.5; color: #33393A">Agua y basura de la ciudad · Exención homestead · Cambio de domicilio · Licencia y registro del carro</p>' if False else 'Agua y basura de la ciudad · Exención homestead · Cambio de domicilio · Licencia y registro del carro</p>',
         'Agua y basura de la ciudad · Exención homestead · Cambio de domicilio · Licencia y registro del carro · <a href="/guia/" style="color: inherit; font-weight: 500">Ver la guía gratis</a></p>')
open('/home/claude/site/index.html', 'w', encoding='utf-8').write(es)

# ---------- English ----------
en = common(s0, 'en')
T = [
 ('<title>ConnectRGV · Tu concierge de servicios para el hogar en el Valle</title>', '<title>ConnectRGV · Your home services concierge in the Valley</title>'),
 ('content="ConnectRGV · Tu concierge de servicios para el hogar en el Valle"', 'content="ConnectRGV · Your home services concierge in the Valley"'),
 ('content="Internet, luz y celular listos para el día de tu mudanza en McAllen, Edinburg, Mission y todo el Valle. Atención en español e inglés, sin costo para ti."',
  'content="Internet, electricity and phone service ready on move-in day in McAllen, Edinburg, Mission and across the Valley. Help in English and Spanish, at no cost to you."', 2),
 ('<meta property="og:url" content="https://connectrgv.com/">', '<meta property="og:url" content="https://connectrgv.com/en/">'),
 ('<meta property="og:locale" content="es_MX">', '<meta property="og:locale" content="en_US">'),
 ('"description": "Concierge de servicios para el hogar: internet, luz y celular para familias que se mudan en el Valle del Río Grande.", "url": "https://connectrgv.com/"',
  '"description": "Home services concierge: internet, electricity and phone service for families moving in the Rio Grande Valley.", "url": "https://connectrgv.com/en/"'),
 ('aria-label="ConnectRGV, inicio"', 'aria-label="ConnectRGV, home"'),
 ('aria-label="Principal"', 'aria-label="Main"'),
 ('>Cómo funciona</a>', '>How it works</a>'),
 ('>Servicios</a>', '>Services</a>'),
 ('<a href="/socios/" style="color: #111312; text-decoration: none">Para realtors</a>', '<a href="/partners/" style="color: #111312; text-decoration: none">For realtors</a>'),
 ('>Preguntas</a>', '>FAQ</a>'),
 ('aria-label="Abrir menú"', 'aria-label="Open menu"'),
 ('aria-label="Llamar al (956) 467-6695"', 'aria-label="Call (956) 467-6695"'),
 ('>Valle del Río Grande</p>', '>Rio Grande Valley</p>'),
 ('>Tu concierge de servicios para el hogar.</h1>', '>Your home services concierge.</h1>'),
 ('Internet, luz y celular listos el día que llegas. Una persona te atiende de principio a fin, en español o inglés, y a ti no te cuesta nada.',
  'Internet, electricity and phone service, ready the day you move in. One person helps you from start to finish, in English or Spanish, and it costs you nothing.'),
 ('alt="Entrada de una casa del Valle con la puerta de madera abierta, luz de tarde y sombra de palma"', 'alt="Entrance of a Valley home with the wooden front door open, late-afternoon light and palm shadows"'),
 ('aria-label="Arma tu plan"', 'aria-label="Build your plan"'),
 ('>¿Cuándo te mudas?</legend>', '>When are you moving?</legend>'),
 ('data-note="Esta semana todavía se puede: te llamamos hoy para apartar las citas." aria-pressed="false">Esta semana</button>',
  'data-note="This week still works: we’ll call you today to book your appointments." data-v="Esta semana" aria-pressed="false">This week</button>'),
 ('data-note="Buen tiempo: alcanzamos a dejar todo listo para tu llegada." aria-pressed="true">La próxima</button>',
  'data-note="Good timing: we can have everything ready for when you arrive." data-v="La próxima" aria-pressed="true">Next week</button>'),
 ('data-note="Excelente: apartamos fechas con calma." aria-pressed="false">2 a 4 semanas</button>',
  'data-note="Great: plenty of time to book your dates." data-v="2 a 4 semanas" aria-pressed="false">In 2–4 weeks</button>'),
 ('data-note="Perfecto para planear: te avisamos cuándo conviene apartar cada cita." aria-pressed="false">Después</button>',
  'data-note="Perfect for planning: we’ll let you know when to book each appointment." data-v="Después" aria-pressed="false">Later</button>'),
 ('>Necesito</legend>', '>I need</legend>'),
 ('aria-pressed="true">Luz</button>', 'data-v="Luz" aria-pressed="true">Electricity</button>'),
 ('aria-pressed="false">Celular</button>', 'data-v="Celular" aria-pressed="false">Phone</button>'),
 ('>Código postal</label>', '>ZIP code</label>', 2),
 ('>Armar mi plan</button>', '>Build my plan</button>'),
 ('<span id="when-note" aria-live="polite">Buen tiempo: alcanzamos a dejar todo listo para tu llegada.</span>',
  '<span id="when-note" aria-live="polite">Good timing: we can have everything ready for when you arrive.</span>'),
 ('aria-label="Quiénes somos"', 'aria-label="About us"'),
 ('Mudarse ya es bastante. Nosotros comparamos lo que llega a tu dirección, contratamos por ti y confirmamos cada cita, ',
  'Moving is a lot already. We compare what’s available at your address, sign you up and confirm every appointment, '),
 ('para que tu primera noche en casa nueva ya tenga Wi-Fi y luz.</span>', 'so your first night in your new home already has Wi-Fi and power.</span>'),
 ('>Presencia</p>', '>Local office</p>'), ('>Oficina física en Palmhurst</p>', '>Walk-in office in Palmhurst</p>'),
 ('>Idioma</p>', '>Language</p>'), ('>Español e inglés, siempre</p>', '>English and Spanish, always</p>'),
 ('>Proveedores</p>', '>Providers</p>'), ('>Compañías autorizadas</p>', '>Authorized companies</p>'),
 ('>Costo para ti</p>', '>Cost to you</p>'), ('>Ninguno</p>', '>None</p>'),
 ('>Cómo funciona</p>', '>How it works</p>'),
 ('>Una llamada.<br>Un plan.<br>Todo conectado.</h2>', '>One call.<br>One plan.<br>Everything connected.</h2>'),
 ('>Te llamamos hoy</h3>', '>We call you today</h3>'),
 ('>El mismo día hábil que llega tu solicitud, por teléfono o WhatsApp.</p>', '>The same business day we get your request, by phone or WhatsApp.</p>'),
 ('>Armamos tu Plan de Mudanza</h3>', '>We build your Moving Plan</h3>'),
 ('>Revisamos qué llega a tu dirección y comparamos las opciones contigo.</p>', '>We check what’s available at your address and go over the options with you.</p>'),
 ('>Tú eliges, con precio por escrito</h3>', '>You choose, with the price in writing</h3>'),
 ('>Sin sorpresas en la primera factura.</p>', '>No surprises on your first bill.</p>'),
 ('>Llegas y todo funciona</h3>', '>You move in and everything works</h3>'),
 ('>Recordatorio antes de cada instalación y llamada al día siguiente.</p>', '>A reminder before each installation and a follow-up call the next day.</p>'),
 ('>Plan de Mudanza</p>', '>Moving Plan</p>'),
 ('>Ejemplo</p>', '>Sample</p>', 2),
 ('>Familia [Apellido]</p>', '>The [Last Name] family</p>'),
 ('>[Dirección], McAllen · llegan el [fecha]</p>', '>[Address], McAllen · moving in [date]</p>'),
 ('>3 de 4 servicios confirmados</p>', '>3 of 4 services confirmed</p>'),
 ('>Instalación [día], 9 a.m.</span>', '>Installation [day], 9 a.m.</span>'),
 ('>Luz</span>', '>Electricity</span>'), ('>Activa desde [fecha]</span>', '>On from [date]</span>'),
 ('>Agua y basura</span>', '>Water &amp; trash</span>'), ('>Guía de la ciudad enviada</span>', '>City guide sent</span>'),
 ('>Celular</span>', '>Phone</span>'), ('>Línea de prueba, por activar</span>', '>Trial line, to be activated</span>'),
 ('>Joel, tu concierge</p>', '>Joel, your concierge</p>'), ('>Responde hoy mismo</p>', '>Gets back to you today</p>'),
 ('>Lo esencial, resuelto.</h2>', '>The essentials, handled.</h2>'),
 ('>Te recomendamos lo que le conviene a tu dirección y a tu familia, no una sola marca.</p>', '>We recommend what’s right for your address and your family, not just one brand.</p>'),
 ('>La mejor opción que de verdad llega a tu casa, con instalación confirmada por escrito.</p>', '>The best option that actually reaches your home, with the installation confirmed in writing.</p>'),
 ('>Cable · Fibra · 5G · Satelital</p>', '>Cable · Fiber · 5G · Satellite</p>'),
 ('>Luz</h3>', '>Electricity</h3>'),
 ('>Comparamos compañías de luz y te explicamos el contrato en palabras claras, antes de firmar.</p>', '>We compare electricity providers and explain the contract in plain English before you sign.</p>'),
 ('>Plan fijo · Renovación con aviso</p>', '>Fixed-rate plans · Renewal reminders</p>'),
 ('>Celular</h3>', '>Cell phone</h3>'),
 ('>Prueba una línea sin compromiso y, si te convence, traemos tus números sin perderlos.</p>', '>Try a line with no commitment and, if you like it, we’ll transfer your numbers without losing them.</p>'),
 ('>Línea de prueba · Cambio de compañía</p>', '>Trial line · Switch carriers</p>'),
 ('>Paquetes y streaming según lo que tu familia realmente ve.</p>', '>Packages and streaming based on what your family actually watches.</p>'),
 ('>Y te guiamos, sin costo, con</p>', '>Plus free guidance with</p>'),
 ('Agua y basura de la ciudad · Exención homestead · Cambio de domicilio · Licencia y registro del carro</p>',
  'City water &amp; trash · Homestead exemption · Change of address · Driver license &amp; vehicle registration · <a href="/guia/?l=en" style="color: inherit; font-weight: 500">See the free guide</a></p>'),
 ('>Una persona,<br>no un call center</p>', '>A real person,<br>not a call center</p>'),
 ('“Cuando nos llamas, te atiendo yo o alguien de mi equipo que conoces por nombre, desde la primera llamada hasta que todo funciona.”',
  '“When you call us, you’ll talk to me or someone on my team you know by name, from the first call until everything is working.”'),
 ('> · Fundador, ConnectRGV</span>', '> · Founder, ConnectRGV</span>'),
 ('>Para realtors y administradores</p>', '>For realtors and property managers</p>'),
 ('>Tú entregas la llave. Nosotros dejamos la casa conectada.</h2>', '>You hand over the keys. We get the home connected.</h2>'),
 ('>Tu página y tu código QR</h3>', '>Your own page and QR code</h3>'),
 ('>connectrgv.com/[tu-nombre]. Cada cliente llega con tu nombre registrado.</p>', '>connectrgv.com/[your-name]. Every client comes in under your name.</p>'),
 ('>Avisos sin tener que llamar</h3>', '>Updates without having to call</h3>'),
 ('>Sabes cuándo contactamos a tu cliente y cuándo quedó todo instalado.</p>', '>You’ll know when we reach your client and when everything is installed.</p>'),
 ('>Tu nombre por delante</h3>', '>Your name front and center</h3>'),
 ('>Nos presentamos como el servicio que tú le regalas a tu cliente.</p>', '>We introduce ourselves as a service you’re providing to your client.</p>'),
 ('>Programa en regla</h3>', '>A compliant program</h3>'),
 ('>Te damos el formato de divulgación listo para tu cliente.</p>', '>We give you a ready-to-use disclosure form for your client.</p>'),
 ('<a href="/socios/"', '<a href="/partners/"'),
 ('>Quiero ser socio</a>', '>Become a partner</a>'),
 ('>Tus referidos</p>', '>Your referrals</p>'),
 ('>[Cliente], Edinburg</p>', '>[Client], Edinburg</p>'),
 ('>Recibido</span>', '>Received</span>'), ('>Contactado</span>', '>Contacted</span>'),
 ('>Servicios elegidos</span>', '>Services chosen</span>'), ('>Instalado</span>', '>Installed</span>'), ('>Próximo</span>', '>Up next</span>'),
 ('>[fecha]</span>', '>[date]</span>', 3),
 ('>[Cliente], Mission</span>', '>[Client], Mission</span>'), ('>Todo instalado</span>', '>All installed</span>'),
 ('>Nuestra promesa</p>', '>Our promise</p>'),
 ('>Por escrito, no de palabra.</h2>', '>In writing, not just a promise.</h2>'),
 ('>Contacto el mismo día hábil</h3>', '>Same-business-day contact</h3>'),
 ('>Si tu solicitud llega en horario de oficina, te llamamos hoy.</p>', '>If your request comes in during office hours, we’ll call you today.</p>'),
 ('>Comparación honesta</h3>', '>An honest comparison</h3>'),
 ('>Te recomendamos lo que te conviene, aunque no sea lo que más nos paga.</p>', '>We recommend what’s best for you, even when it isn’t what pays us the most.</p>'),
 ('>Precio antes de firmar</h3>', '>The price before you sign</h3>'),
 ('>Todo por escrito y sin letras chiquitas.</p>', '>Everything in writing, with no fine print.</p>'),
 ('>Tus datos son tuyos</h3>', '>Your information is yours</h3>'),
 ('>Los usamos solo para tus servicios. Nunca los vendemos.</p>', '>We only use it for your services. We never sell it.</p>'),
 ('>Preguntas frecuentes</h2>', '>Frequently asked questions</h2>'),
 ('>¿Cuánto me cuesta?<span', '>How much does it cost me?<span'),
 ('>Nada. Solo pagas tus servicios directamente a cada compañía, al mismo precio que si los contrataras tú.</p>',
  '>Nothing. You pay each company directly for your services, at the same price as if you signed up on your own.</p>'),
 ('>Si es gratis, ¿cómo ganan ustedes?<span', '>If it’s free, how do you make money?<span'),
 ('>Las compañías nos pagan una comisión por cada cliente que conectamos. Por eso a ti nunca te cobramos.</p>',
  '>The providers pay us a commission for each customer we connect. That’s why we never charge you.</p>'),
 ('>¿Puedo escoger compañía de luz en mi dirección?<span', '>Can I choose my electricity provider at my address?<span'),
 ('>En la mayor parte del Valle, sí. Algunas zonas rurales tienen cooperativa; si es tu caso, te decimos cómo contratar directo con ella.</p>',
  '>In most of the Valley, yes. Some rural areas are served by an electric co-op; if that’s your case, we’ll tell you how to sign up with them directly.</p>'),
 ('>Me mudo mañana, ¿todavía alcanzan?<span', '>I’m moving tomorrow. Is there still time?<span'),
 ('>Llámanos hoy. Muchas activaciones salen el mismo día y, si algo tarda más, te decimos la fecha real desde el principio.</p>',
  '>Call us today. Many activations happen the same day, and if something takes longer, we’ll give you the real date up front.</p>'),
 ('aria-label="Empezar"', 'aria-label="Get started"'),
 ('>Que tu primera noche en casa nueva ya tenga Wi-Fi.</h2>', '>Have Wi-Fi on your very first night in your new home.</h2>'),
 ('>Armar mi plan</a>', '>Build my plan</a>'),
 ('>o llama al (956) 467-6695</a>', '>or call (956) 467-6695</a>'),
 ('>Tu concierge de servicios para el hogar.</p>', '>Your home services concierge.</p>'),
 ('>Oficina</p>', '>Office</p>'),
 ('>Horario</p>', '>Hours</p>'),
 ('>Lunes a viernes, 10 a 6<br>Sábado, 10 a 5</p>', '>Monday–Friday, 10 a.m.–6 p.m.<br>Saturday, 10 a.m.–5 p.m.</p>'),
 ('Servicios de internet a través de MirComm, retailer autorizado. Disponibilidad, precios y velocidades varían según la dirección.',
  'Internet services provided through MirComm, an authorized retailer. Availability, pricing and speeds vary by address.'),
 ('>¿A quién le llamamos?</h2>', '>Who should we call?</h2>'),
 ('aria-label="Cerrar"', 'aria-label="Close"'),
 ('>Te llamamos el mismo día hábil para armar tu Plan de Mudanza.</p>', '>We’ll call you the same business day to build your Moving Plan.</p>'),
 ('>Tu nombre</label>', '>Your name</label>'),
 ('>Teléfono</label>', '>Phone</label>'),
 ('>Dirección de la casa nueva</legend>', '>Your new home’s address</legend>'),
 ('>Con ella revisamos qué servicios llegan a tu casa. Escríbela completa, por favor.</p>', '>We use it to check which services reach your home. Please enter the full address.</p>'),
 ('>Número y calle</label>', '>Street address</label>'),
 ('placeholder="Ej. 1234 N. 10th St."', 'placeholder="e.g. 1234 N. 10th St."'),
 ('>Depto., unidad o lote</label>', '>Apt., unit or lot</label>'),
 ('placeholder="Si aplica"', 'placeholder="If any"'),
 ('>Ciudad</label>', '>City</label>'),
 ('placeholder="Ej. McAllen"', 'placeholder="e.g. McAllen"'),
 ('>Ese código postal no es del Valle. Revísalo, por favor.</p>', '>That ZIP code isn’t in the Valley. Please double-check it.</p>'),
 ('>Así la tenemos</p>', '>Here’s what we have</p>'),
 ('>Escribe tu dirección arriba.</p>', '>Enter your address above.</p>'),
 ('>Confirmo que la dirección está completa y correcta.</label>', '>I confirm the address is complete and correct.</label>'),
 ('>Que me llamen hoy</button>', '>Call me today</button>'),
 ('>Listo. Te llamamos hoy.</h2>', '>All set. We’ll call you today.</h2>'),
 ('>Si llegó fuera de horario, te llamamos el siguiente día hábil.</p>', '>If it came in after hours, we’ll call you the next business day.</p>'),
 ('>Cerrar</button>', '>Close</button>'),
]
for t in T:
    en = rep(en, t[0], t[1], t[2] if len(t) > 2 else 1)
open('/home/claude/site/en/index.html', 'w', encoding='utf-8').write(en)

# Lo que quede en español en el texto visible de la versión en inglés
vis = re.sub(r'<script.*?</script>|<style.*?</style>|<svg.*?</svg>', ' ', en, flags=re.S)
txt = re.sub(r'<[^>]+>', '\n', vis)
sus = [l.strip() for l in txt.split('\n') if re.search(r'[áéíóúñ¿¡]|\b(de|la|el|tu|que|para|con|los|las)\b', l)]
print('Posible español que queda:', sus)
attrs = re.findall(r'(?:aria-label|placeholder|alt|title|data-note)="([^"]*)"', en)
print('Atributos:', [a for a in attrs if re.search(r'[áéíóúñ¿¡]|\b(de|la|el|tu|que|para|con)\b', a)])
