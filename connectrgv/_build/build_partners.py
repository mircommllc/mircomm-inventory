import re, os
s = open('socios-live.html', encoding='utf-8').read()

def R(src, a, b, label):
    assert src.count(a) >= 1, (label, a[:80])
    return src.replace(a, b)

def T(src, a, b, label):
    return R(src, '>' + a + '<', '>' + b + '<', label)

HEAD_ES = '<link rel="canonical" href="https://connectrgv.com/socios/">'
ALT = ('\n<meta name="google" content="notranslate">'
       '\n<link rel="alternate" hreflang="es" href="https://connectrgv.com/socios/">'
       '\n<link rel="alternate" hreflang="en" href="https://connectrgv.com/partners/">')
navre = re.compile(r'(<a href="/" (style="[^"]*")>Para familias</a>)')

# ── Español: enlace a English, sin traducción automática, términos corregidos ──
es = R(s, '<html lang="es">', '<html lang="es" translate="no">', 'es')
es = R(es, HEAD_ES, HEAD_ES + ALT, 'es')
es = navre.sub(lambda m: m.group(1) + '\n<a href="/partners/" lang="en" hreflang="en" ' + m.group(2) + '>English</a>', es, 1)
assert 'hreflang="en" style' in es
es = R(es, '>Administradores de casas y dúplex<', '>Administradores de propiedades<', 'es')
es = R(es, 'Por texto o WhatsApp: contactado, servicios elegidos, todo instalado.', 'Por correo o WhatsApp: contactado, servicios elegidos, todo instalado.', 'es')
es = R(es, 'Te avisamos por texto o WhatsApp cuando', 'Te avisamos por correo o WhatsApp cuando', 'es')

# ── Inglés: redactado como lo diría un realtor de Texas, no traducido palabra por palabra ──
en = R(s, '<html lang="es">', '<html lang="en" translate="no">', 'en')
en = R(en, HEAD_ES, '<link rel="canonical" href="https://connectrgv.com/partners/">' + ALT, 'en')
en = navre.sub(lambda m: m.group(1).replace('Para familias', 'For families') + '\n<a href="/socios/" lang="es" hreflang="es" ' + m.group(2) + '>Español</a>', en, 1)
raw = [
    ('<title>ConnectRGV para socios · Realtors y administradores del Valle</title>', '<title>ConnectRGV for Partners · Realtors and Property Managers in the Valley</title>'),
    ('content="ConnectRGV para socios · Realtors y administradores del Valle"', 'content="ConnectRGV for Partners · Realtors and Property Managers in the Valley"'),
    ('content="Regálale a cada cliente un concierge para su mudanza. Internet, luz y celular con tu nombre por delante, y avisos en cada paso."',
     'content="Give every client a move-in concierge. Internet, electricity and phone set up with your name front and center, and updates at every step."'),
    ('<meta property="og:url" content="https://connectrgv.com/socios/">', '<meta property="og:url" content="https://connectrgv.com/partners/">'),
    ('<meta property="og:locale" content="es_MX">', '<meta property="og:locale" content="en_US">'),
    ('aria-label="ConnectRGV, inicio"', 'aria-label="ConnectRGV, home"'), ('aria-label="Principal"', 'aria-label="Main"'),
    ('aria-label="Abrir menú"', 'aria-label="Open menu"'), ('aria-label="Comparación con y sin ConnectRGV"', 'aria-label="Comparison with and without ConnectRGV"'),
    ('aria-label="Aquí va tu código QR"', 'aria-label="Your QR code goes here"'),
    ('[Cliente]', '[Client]'), ('[fecha]', '[date]'), ('connectrgv.com/[tu-nombre]', 'connectrgv.com/[your-name]'),
    ('>Administradores de casas y dúplex<', '>Property managers<'), ('>Constructoras<', '>Home builders<'), ('>Agentes de seguros<', '>Insurance agents<'),
    ('¿Prefieres hablar ya?', 'Rather talk now?'),
    # Las opciones mandan a la hoja el mismo valor en español, para que el Hub las lea igual
    ('<option>Realtor</option><option>Administrador de propiedades</option><option>Constructora</option><option>Agente de seguros</option><option>Compañía de mudanza</option><option>Otro</option>',
     '<option value="Realtor">Realtor</option><option value="Administrador de propiedades">Property manager</option><option value="Constructora">Home builder</option><option value="Agente de seguros">Insurance agent</option><option value="Compañía de mudanza">Moving company</option><option value="Otro">Other</option>'),
    ('<option>1 a 3</option><option>4 a 10</option><option>Más de 10</option>', '<option value="1 a 3">1–3</option><option value="4 a 10">4–10</option><option value="Más de 10">More than 10</option>'),
    ('Ver la página que recibe tu cliente', 'See the page your client gets'),
    ('¿Le cuesta algo a mi cliente?', 'Does it cost my client anything?'), ('¿Se van a quedar con mi cliente?', 'Will you take over my client?'),
    ('¿Cómo me entero del avance?', 'How will I know how it is going?'), ('¿Trabajan con complejos de apartamentos?', 'Do you work with apartment complexes?'),
    ('Un regalo de<br>[Tu nombre]', 'A gift from<br>[Your name]'), ('Tres pasos.<br>Tú solo haces el primero.', 'Three steps.<br>You only do the first one.'),
    ('Lunes a viernes, 10 a 6<br>Sábado, 10 a 5', 'Monday–Friday, 10 a.m.–6 p.m.<br>Saturday, 10 a.m.–5 p.m.'),
]
for a, b in raw:
    en = R(en, a, b, 'en')
txt = [
    ('Cómo funciona', 'How it works'), ('Compensación', 'Compensation'), ('Preguntas', 'FAQ'), ('Registrarme como socio', 'Become a partner'),
    ('Para realtors, administradores y constructoras', 'For realtors, property managers and home builders'),
    ('Tú entregas la llave. Nosotros dejamos la casa conectada.', 'You hand over the keys. We get the home connected.'),
    ('Regálale a cada cliente un concierge para su mudanza. Nosotros resolvemos internet, luz y celular con tu nombre por delante, y tú recibes un aviso en cada paso.',
     'Give every client a move-in concierge. We set up their internet, electricity and phone service with your name front and center, and we keep you posted at every step.'),
    ('Quiero ser socio', 'Become a partner'), ('Ver lo que recibe tu cliente', 'See what your client gets'), ('Tus referidos', 'Your referrals'), ('Ejemplo', 'Example'),
    ('Cierre el [date] · Internet, luz y celular', 'Closing on [date] · Internet, electricity and phone'),
    ('Recibido', 'Received'), ('Contactado el mismo día', 'Contacted the same day'), ('Servicios elegidos', 'Services chosen'), ('Instalado', 'Installed'),
    ('Próximo', 'Up next'), ('Todo instalado', 'All set up'),
    ('Lo que cambia después del cierre.', 'What changes after closing.'),
    ('Los días después de entregar la llave también hablan de ti. Así se ven con y sin concierge.',
     'The days after you hand over the keys reflect on you, too. Here is how they look with and without a concierge.'),
    ('Momento', 'When'), ('Sin concierge', 'Without a concierge'), ('Con ConnectRGV', 'With ConnectRGV'),
    ('Firmando el cierre', 'At the closing table'),
    ('Tu cliente te pregunta con quién pone la luz y el internet.', 'Your client asks you who to call for electricity and internet.'),
    ('Le das tu tarjeta con código QR y queda en buenas manos.', 'You hand them your card with a QR code, and they are in good hands.'),
    ('Esa misma semana', 'That same week'),
    ('Compara planes solo y espera en línea con cuatro compañías.', 'They compare plans on their own and wait on hold with four different companies.'),
    ('Lo llamamos el mismo día hábil y armamos su Plan de Mudanza.', 'We call them the same business day and put together their Moving Plan.'),
    ('El día de la mudanza', 'Move-in day'),
    ('Llega sin Wi-Fi y te escribe para ver si conoces a alguien.', 'They arrive with no Wi-Fi and text you to ask if you know someone.'),
    ('Llega con internet y luz funcionando, y la cita confirmada por escrito.', 'They arrive to working internet and electricity, with every appointment confirmed in writing.'),
    ('Un mes después', 'A month later'), ('Ya no se acuerda de quién le vendió la casa.', 'They no longer remember who helped them with the home.'),
    ('Recuerda que tú le resolviste todo, y te recomienda.', 'They remember you took care of everything, and they refer you.'),
    ('Cómo funciona para ti', 'How it works for you'), ('Comparte tu enlace o tu código QR', 'Share your link or QR code'),
    ('En tu paquete de cierre, en la bienvenida al inquilino o por WhatsApp.', 'In your closing packet, in your tenant welcome kit, or by WhatsApp.'),
    ('Nosotros atendemos a tu cliente', 'We take care of your client'),
    ('Lo llamamos el mismo día hábil, comparamos opciones y confirmamos cada cita.', 'We call them the same business day, compare their options and confirm every appointment.'),
    ('Te avisamos en cada paso', 'We keep you posted at every step'),
    ('Por texto o WhatsApp: contactado, servicios elegidos, todo instalado.', 'By email or WhatsApp: contacted, services chosen, all set up.'),
    ('Tu código QR', 'Your QR code'), ('Escanea y te dejamos internet, luz y celular listos para tu mudanza.', 'Scan and we will have your internet, electricity and phone ready for move-in day.'),
    ('Con quién trabajamos', 'Who we work with'), ('Compañías de mudanza', 'Moving companies'),
    ('Compensación y compromiso', 'Compensation and commitment'), ('Claro, por escrito y en regla.', 'Clear, in writing and by the book.'),
    ('Hay compensación por cada cliente que conectamos. Te la detallamos en un acuerdo sencillo antes de empezar, con fechas de pago y reporte de cada referido.',
     'You are compensated for every client we connect. We spell it out in a simple agreement before we start, with payment dates and a report on every referral.'),
    ('Tu cliente, contactado hoy', 'Your client, contacted today'), ('El mismo día hábil que llega el referido.', 'The same business day the referral comes in.'),
    ('Solo lo que autorizas', 'Only what you authorize'), ('Nunca contactamos a tu cliente para nada más.', 'We never contact your client about anything else.'),
    ('Si algo sale mal, lo resuelve Joel', 'If something goes wrong, Joel handles it'),
    ('Directamente, sin pasarte de departamento en departamento.', 'Personally, without bouncing you from one department to another.'),
    ('Divulgación lista', 'Disclosure ready'), ('Te damos el formato para informar a tu cliente, como pide la ley de Texas.', 'We give you the disclosure form for your client, as Texas law requires.'),
    ('Registro de socios', 'Partner sign-up'), ('Empecemos con tu próximo cierre.', 'Let’s start with your next closing.'),
    ('Déjanos tus datos y te llamamos para entregarte tu página, tu código QR y el acuerdo por escrito.',
     'Leave your information and we will call you to set up your page, your QR code and the written agreement.'),
    ('Nombre completo', 'Full name'), ('Empresa o agencia', 'Company or brokerage'), ('Soy', 'I am a'), ('Mudanzas al mes', 'Moves per month'),
    ('Teléfono', 'Phone'), ('Correo', 'Email'),
    ('Te llamamos en horario de oficina. Tus datos solo se usan para el programa.', 'We will call you during business hours. Your information is used only for the partner program.'),
    ('Gracias. Te llamamos hoy mismo.', 'Thank you. We will call you today.'),
    ('Si llegó fuera de horario, te llamamos el siguiente día hábil para entregarte tu página y tu código QR.', 'If it came in after hours, we will call you the next business day to set up your page and QR code.'),
    ('Registrar a otra persona', 'Sign up someone else'), ('Preguntas de socios', 'Partner FAQ'),
    ('No. Paga sus servicios directamente a cada compañía, al mismo precio que si los contratara solo.', 'No. They pay each provider directly, at the same price as if they signed up on their own.'),
    ('No. Solo nos encargamos de los servicios del hogar y siempre te presentamos a ti como quien le regaló el servicio.',
     'No. We only handle home services, and we always introduce you as the one who gave them the service.'),
    ('Te avisamos por texto o WhatsApp cuando contactamos a tu cliente, cuando elige sus servicios y cuando queda todo instalado.',
     'We let you know by email or WhatsApp when we reach your client, when they choose their services and when everything is set up.'),
    ('Sí, con la luz, cuando cada departamento tiene su propio medidor. El internet depende del contrato que ya tenga la propiedad.',
     'Yes, for electricity, when each unit has its own meter. Internet depends on the contract the property already has in place.'),
    ('Tu concierge de servicios para el hogar.', 'Your home services concierge.'), ('Oficina', 'Office'), ('Horario', 'Hours'),
    ('Servicios de internet a través de MirComm, retailer autorizado. © 2026 ConnectRGV.', 'Internet service provided through MirComm, an authorized retailer. © 2026 ConnectRGV.'),
]
for a, b in txt:
    en = T(en, a, b, 'en')

os.makedirs('partners', exist_ok=True); os.makedirs('socios', exist_ok=True)
open('socios/index.html', 'w', encoding='utf-8').write(es)
open('partners/index.html', 'w', encoding='utf-8').write(en)

body = en[en.index('<body'):]
body = re.sub(r'<script[\s\S]*?</script>|<svg[\s\S]*?</svg>|<[^>]+>', '\n', body)
lines = [l.strip() for l in body.split('\n') if l.strip()]
left = [l for l in lines if re.search(r'[áéíóúñ¿¡]|\b(para|con|sin|los|las|del|que|tu|tus|socio|cierre|luz|hoy|y)\b', l)]
print('restos en español:', left)
