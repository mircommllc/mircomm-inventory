# Pone el botón Español / English (siempre visible) en /socios/ y /partners/, y en la plantilla de páginas de socio.
import re
DARK = """.lang-sw{display:inline-flex;align-items:center;gap:2px;padding:3px;border:1px solid rgba(243,241,236,.4);border-radius:999px}
.lang-sw a{min-height:38px;padding:0 14px;display:inline-flex;align-items:center;border-radius:999px;font-size:14px;font-weight:500;line-height:1;color:#F3F1EC;text-decoration:none;white-space:nowrap}
.lang-sw a[aria-current]{background:#F3F1EC;color:#1E3A32}
.lang-sw .lg-s{display:none}
@media (max-width: 560px){.lang-sw a{padding:0 11px}.lang-sw .lg-l{display:none}.lang-sw .lg-s{display:inline}}
@media (max-width: 560px){header > div{column-gap:12px!important}header div:has(> .lang-sw){gap:6px!important}header img[src*="connectrgv-logo"]{width:128px;height:auto}.menu-btn{min-width:40px!important}}"""
def sw(cur, es, en):
    a = lambda code, href, long, short: ('<a href="%s" lang="%s" hreflang="%s" data-lang="%s"%s><span class="lg-l">%s</span><span class="lg-s" aria-hidden="true">%s</span></a>'
        % (href, code, code, code, ' aria-current="page"' if cur == code else '', long, short))
    return '<div class="lang-sw" role="group" aria-label="Idioma / Language">' + a('es', es, 'Español', 'ES') + a('en', en, 'English', 'EN') + '</div>\n'
def redirect(to_lang, to_path):
    return "<script>try{if(localStorage.getItem('cgv_lang')==='%s'&&!/[?&]l=/.test(location.search))location.replace('%s'+location.hash)}catch(e){}</script>" % (to_lang, to_path)

for path, cur in [('socios/index.html', 'es'), ('partners/index.html', 'en')]:
    s = open(path, encoding='utf-8').read()
    if 'class="lang-sw"' in s: continue
    other = 'partners' if cur == 'es' else 'socios'
    link = re.search(r'\n<a href="/%s/" lang="[a-z]+" hreflang="[a-z]+" style="[^"]*">[^<]*</a>' % other, s)
    assert link, path
    s = s.replace(link.group(0), '', 1)
    marker = '<button class="menu-btn" type="button"'
    assert s.count(marker) == 1
    s = s.replace(marker, sw(cur, '/socios/', '/partners/') + marker, 1)
    s = s.replace('.menu-btn,.phone-icon{display:none}', '.menu-btn,.phone-icon{display:none}\n' + DARK, 1)
    s = s.replace('<meta name="theme-color" content="#1E3A32">', '<meta name="theme-color" content="#1E3A32">\n' + (redirect('en', '/partners/') if cur == 'es' else redirect('es', '/socios/')), 1)
    assert 'lang-sw{' in s and 'cgv_lang' in s
    open(path, 'w', encoding='utf-8').write(s)
    print('ok', path)
