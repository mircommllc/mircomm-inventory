/**
 * SesionManager.gs — los administradores (Joel, Maricela…) entran a 🎯 Prospectos con su sesión, sin PIN de 6 dígitos.
 * ------------------------------------------------------------------
 * Cuando un administrador ya entró al Hub con su PIN, el Hub manda su sesión (mt) y deja el PIN vacío.
 * Aquí se revisa que la sesión sea de administrador, se pone su nombre (el de la sesión, no el que mande
 * el navegador) y su PIN interno de Prospectos, todo en el servidor. El PIN nunca se manda al navegador.
 * Si el administrador todavía no existe en Prospectos (por ejemplo Maricela), se da de alta solo.
 * Las asesoras siguen entrando con su PIN de 6 dígitos como siempre.
 *
 * Va en Code.gs como la PRIMERA línea dentro de hubGet_(e):
 *        prosSessionPin_(e);
 */
function prosSessionPin_(e) {
  var p = e && e.parameter;
  if (!p || p.pin) return;                                    // ya trae PIN: no se toca
  if (String(p.action || '').indexOf('pros') !== 0) return;   // solo acciones de Prospectos
  if (!isManagerToken_(p.mt)) return;                         // solo con sesión de administrador vigente
  var name = CacheService.getScriptCache().get('ses_' + p.mt) || 'Joel';
  var u = null;
  if (typeof adminEnsurePros_ === 'function') u = adminEnsurePros_(name);
  else {
    var raw = PropertiesService.getScriptProperties().getProperty('PROSPECTOS_CONFIG');
    if (raw) u = ((JSON.parse(raw) || {}).usuarios || {})[name];
  }
  if (u && u.manager) { p.user = name; p.pin = String(u.pin); }
}
