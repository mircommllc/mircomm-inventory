/**
 * Admins.gs — Administradores del MirComm Store Hub (Joel, Maricela…) + Historial de cambios
 * -----------------------------------------------------------------------------
 * - Cada administrador entra con SU PROPIO PIN de 4 dígitos en "🔒 Administración".
 *   No hay lista de nombres: el PIN dice quién eres. Las asesoras siguen igual (su nombre + PIN de 6 dígitos).
 * - Los dos ven y cambian lo mismo, pero el Hub sabe quién está conectado:
 *   firma de correos, "Quién lo hace", sus 3 prioridades, Prospectos y Claude salen con su nombre.
 * - TODO cambio que se hace desde el Hub queda en la hoja "Auditoria" con fecha, persona, módulo,
 *   acción, registro y detalle. Se ve en el Hub en 🧾 Historial de cambios.
 * - Los PINs se guardan cifrados (hash) en Script Properties, nunca en index.html ni en este archivo.
 * - Solo el dueño (Joel) puede cambiar el límite de gasto de Claude y cerrar las sesiones de los demás.
 *   Los PINs solo se dan de alta aquí en Apps Script.
 *
 * Usa: hubGet_ / hubPost_ (Code.gs), SPREADSHEET_ID (Code.gs).
 *
 * INSTALAR (una vez):
 *  1. Apps Script: ＋ → Script → nómbralo "Admins" → pega todo este archivo → Guardar.
 *  2. Pega el Code.gs nuevo (ahí doGet/doPost se llaman hubGet_/hubPost_; las de aquí van primero).
 *  3. Alta de Maricela: abajo escribe NUEVO_ADMIN_NOMBRE = 'Maricela' y NUEVO_ADMIN_PIN = '#### (4 dígitos)'
 *     → selecciona configurarAdmin → ▶ Run. Luego deja las dos en '' y Guardar.
 *     (Tu PIN de manager de siempre sigue funcionando: Joel se da de alta solo la primera vez.)
 *  4. Deploy → Manage deployments → ✏️ → New version → Deploy.
 *
 * OTRAS COSAS QUE PUEDES CORRER AQUÍ:
 *  - Cambiar el PIN de alguien: mismo paso 3 con su nombre y el PIN nuevo.
 *  - Quitar a un administrador: NUEVO_ADMIN_NOMBRE = 'Nombre' → quitarAdmin → Run.
 *  - Ver quiénes son administradores: verAdmins → Run.
 */

// Escribe aquí solo mientras corres configurarAdmin / quitarAdmin; después déjalas vacías ('').
var NUEVO_ADMIN_NOMBRE = '';
var NUEVO_ADMIN_PIN = '';
// Firma de sus correos (opcional). Si la dejas vacía: "Nombre / MirComm LLC / 956-603-6505".
var NUEVO_ADMIN_FIRMA = '';

var ADMIN_OWNER = 'Joel';
var ADMIN_OWNER_FIRMA = 'Joel Chavez\nOwner / General Manager\nMirComm LLC · Spectrum Rep ID CMMCL4423\n956-603-6505';
var ADMIN_SESSION_SECONDS = 21600;   // 6 horas (lo más que guarda CacheService); cada uso la renueva
var ADMIN_MAX_FAILS = 5;             // PINs incorrectos antes de bloquear 15 minutos
var AUD_SHEET = 'Auditoria';
var AUD_HEADERS = ['Fecha', 'Usuario', 'Rol', 'Modulo', 'Accion', 'Registro', 'Detalle', 'Resultado'];

var ADMIN_ME_ = '';   // quién está conectado en esta llamada (lo pone adminHandle_)

// ─── Entrada del Web App ───────────────────────────────────────────
function doGet(e) { return adminHandle_(e, hubGet_); }
function doPost(e) { return adminHandle_(e, hubPost_); }

function adminHandle_(e, core) {
  var p = (e && e.parameter) || {}, body = {};
  if (e && e.postData && e.postData.contents) { try { body = JSON.parse(e.postData.contents) || {}; } catch (x) { body = {}; } }
  var a = String(p.action || body.action || '');
  var token = String(p.mt || body.mt || '');
  var cache = CacheService.getScriptCache();
  var sesName = token ? cache.get('ses_' + token) : null;
  var isAdm = !!(token && sesName && cache.get('mgr_' + token) === '1');
  if (isAdm) {
    ADMIN_ME_ = sesName;
    // Seguimiento.gs usa SEG_MANAGER como "quién es el manager": en esta llamada es quien está conectado.
    if (typeof SEG_MANAGER !== 'undefined') SEG_MANAGER = sesName;
  }
  if (a === 'managerLogin') return adminJson_(adminSafe_(function () { return adminLogin_(p.pin !== undefined ? p.pin : body.pin); }));
  if (a.indexOf('admin') === 0) return adminJson_(adminSafe_(function () { return adminRoute_(a, p, body, token, isAdm); }));
  if (a === 'repResumen') return adminJson_(adminSafe_(function () { return repResumen_(p.user !== undefined ? p : body); }));
  if (a === 'repDeskDone') {
    var outD = adminJson_(adminSafe_(function () { return repDeskDone_(p.user !== undefined ? p : body); }));
    try { audMaybeLog_(a, p, body, false, null, outD); } catch (x) {}
    return outD;
  }
  var out = core(e);
  if (a === 'posPending' || a === 'actRepPending') out = simAddPending_(out, a === 'actRepPending' ? String(p.user || body.user || '') : '');
  try { audMaybeLog_(a, p, body, isAdm, sesName, out); } catch (x) { /* el historial nunca debe tumbar el Hub */ }
  return out;
}
function adminJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function adminSafe_(fn) { try { return fn(); } catch (err) { return { error: String((err && err.message) || err) }; } }

/** Nombre de quien está conectado (administrador). Fuera de una llamada del Hub (triggers) es Joel. */
function adminMe_() { return ADMIN_ME_ || ADMIN_OWNER; }
function adminInfo_(name) {
  var a = adminList_()[name || adminMe_()] || {};
  return { name: name || adminMe_(), owner: !!a.owner, firma: a.firma || adminDefaultFirma_(name || adminMe_()) };
}
function adminDefaultFirma_(name) { return name === ADMIN_OWNER ? ADMIN_OWNER_FIRMA : name + '\nMirComm LLC\n956-603-6505'; }
/** Firma de correo de quien está conectado. */
function adminFirma_() { return adminInfo_().firma; }
/** Nombre para el "De:" de los correos ("Joel Chavez - MirComm LLC"). */
function adminFromName_() { return String(adminFirma_().split('\n')[0] || adminMe_()).trim() + ' - MirComm LLC'; }
function adminIsOwner_() { return adminInfo_().owner; }
function adminNames_() { return Object.keys(adminList_()); }

// ─── Lista de administradores (Script Properties → ADMINS) ─────────
function adminList_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('ADMINS');
  if (raw) { try { return JSON.parse(raw) || {}; } catch (e) {} }
  // Primera vez: Joel entra con el PIN de manager que ya tenía (configurarPinManager).
  var old = props.getProperty('MANAGER_PIN');
  if (!old) return {};
  var list = {};
  list[ADMIN_OWNER] = adminNewEntry_(old, true, ADMIN_OWNER_FIRMA);
  props.setProperty('ADMINS', JSON.stringify(list));
  return list;
}
function adminSave_(list) { PropertiesService.getScriptProperties().setProperty('ADMINS', JSON.stringify(list)); }
function adminNewEntry_(pin, owner, firma) {
  var s = Utilities.getUuid();
  return { h: adminHash_(pin, s), s: s, owner: !!owner, firma: firma || '' };
}
function adminHash_(pin, salt) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + '|' + String(pin), Utilities.Charset.UTF_8);
  return d.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function configurarAdmin() {
  var name = String(NUEVO_ADMIN_NOMBRE || '').trim();
  var pin = String(NUEVO_ADMIN_PIN || '').trim();
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ .'-]{1,29}$/.test(name)) throw new Error('Escribe el nombre en NUEVO_ADMIN_NOMBRE (por ejemplo Maricela).');
  if (!/^\d{4}$/.test(pin)) throw new Error('El PIN de administrador es de 4 dígitos. Escríbelo en NUEVO_ADMIN_PIN.');
  if (/^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '4321') throw new Error('Ese PIN es muy fácil de adivinar. Usa otro.');
  var list = adminList_();
  Object.keys(list).forEach(function (n) {
    if (n !== name && adminHash_(pin, list[n].s) === list[n].h) throw new Error('Ese PIN ya lo usa ' + n + '. Cada quien necesita uno distinto.');
  });
  var users = adminProsUsers_();
  if (users[name] && !users[name].manager) throw new Error(name + ' ya existe como asesora en Prospectos. Usa otro nombre.');
  var prev = list[name];
  var owner = name === ADMIN_OWNER || !!(prev && prev.owner);
  var firma = String(NUEVO_ADMIN_FIRMA || '').trim() || (prev && prev.firma) || adminDefaultFirma_(name);
  list[name] = adminNewEntry_(pin, owner, firma);
  if (!list[ADMIN_OWNER] && name !== ADMIN_OWNER) {
    var old = PropertiesService.getScriptProperties().getProperty('MANAGER_PIN');
    if (old) list[ADMIN_OWNER] = adminNewEntry_(old, true, ADMIN_OWNER_FIRMA);
  }
  adminSave_(list);
  adminEnsurePros_(name);
  CacheService.getScriptCache().remove('mgr_fails');
  Logger.log((prev ? 'PIN cambiado para ' : 'Listo: ') + name + (prev ? '.' : ' ya es administrador(a) del Hub.') +
    ' Administradores: ' + Object.keys(list).join(', ') + '. Ahora borra el PIN de NUEVO_ADMIN_PIN (deja \'\'), Guardar y Deploy → New version.');
}

function quitarAdmin() {
  var name = String(NUEVO_ADMIN_NOMBRE || '').trim();
  var list = adminList_();
  if (!list[name]) throw new Error('No encontré a "' + name + '". Administradores: ' + Object.keys(list).join(', '));
  if (list[name].owner) throw new Error('No se puede quitar al dueño.');
  delete list[name];
  adminSave_(list);
  adminDropTokens_(function (t) { return t.n === name; });
  Logger.log(name + ' ya no es administrador(a). Se cerraron sus sesiones.');
}

function verAdmins() {
  var list = adminList_();
  Logger.log('Administradores: ' + Object.keys(list).map(function (n) { return n + (list[n].owner ? ' (dueño)' : ''); }).join(', '));
}

// Cada administrador también existe en Prospectos (con un PIN interno al azar que nadie usa;
// entra con su sesión), para que lo que registre ahí quede a su nombre.
function adminProsUsers_() {
  try { return (JSON.parse(PropertiesService.getScriptProperties().getProperty('PROSPECTOS_CONFIG') || '{}').usuarios) || {}; }
  catch (e) { return {}; }
}
function adminEnsurePros_(name) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('PROSPECTOS_CONFIG');
  if (!raw) return null;
  var cfg = JSON.parse(raw); cfg.usuarios = cfg.usuarios || {};
  var u = cfg.usuarios[name];
  if (u) return u;
  var used = {};
  Object.keys(cfg.usuarios).forEach(function (n) { used[String(cfg.usuarios[n].pin)] = 1; });
  var pin;
  do { pin = String(100000 + Math.floor(Math.random() * 900000)); } while (used[pin]);
  u = cfg.usuarios[name] = { pin: pin, manager: true, codigo: '', repIds: [] };
  props.setProperty('PROSPECTOS_CONFIG', JSON.stringify(cfg));
  return u;
}

// ─── Login ─────────────────────────────────────────────────────────
function adminLogin_(pin) {
  pin = String(pin === undefined || pin === null ? '' : pin).trim();
  var cache = CacheService.getScriptCache();
  var fails = +(cache.get('mgr_fails') || 0);
  if (fails >= ADMIN_MAX_FAILS) throw new Error('Demasiados intentos. Espera 15 minutos.');
  var list = adminList_();
  if (!Object.keys(list).length) throw new Error('Falta correr configurarPinManager o configurarAdmin en Apps Script.');
  var who = null;
  Object.keys(list).forEach(function (n) { if (!who && adminHash_(pin, list[n].s) === list[n].h) who = n; });
  if (!who) {
    cache.put('mgr_fails', String(fails + 1), 900);
    audWrite_(['(desconocido)', 'Admin', 'Acceso', 'PIN de administrador incorrecto', '', 'intento ' + (fails + 1) + ' de ' + ADMIN_MAX_FAILS, 'Rechazado']);
    return { ok: false };
  }
  cache.remove('mgr_fails');
  var token = Utilities.getUuid();
  cache.put('mgr_' + token, '1', ADMIN_SESSION_SECONDS);
  cache.put('ses_' + token, who, ADMIN_SESSION_SECONDS);
  adminTrackToken_(token, who);
  ADMIN_ME_ = who;
  audWrite_([who, 'Admin', 'Acceso', 'Entró al Hub', '', '', 'OK']);
  var info = adminInfo_(who);
  return { ok: true, token: token, user: { name: who, owner: info.owner, firma: info.firma, manager: true }, admins: Object.keys(list) };
}

// Sesiones de administrador abiertas (para poder cerrarlas desde el Hub).
function adminTokens_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ADMIN_TOKENS') || '[]'); } catch (e) { return []; }
}
function adminTrackToken_(token, name) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var cutoff = Date.now() - 3 * 86400000;
    var list = adminTokens_().filter(function (t) { return t.at > cutoff; });
    list.push({ t: token, n: name, at: Date.now() });
    PropertiesService.getScriptProperties().setProperty('ADMIN_TOKENS', JSON.stringify(list.slice(-40)));
  } finally { lock.releaseLock(); }
}
function adminDropTokens_(match) {
  var cache = CacheService.getScriptCache(), keep = [], n = 0;
  adminTokens_().forEach(function (t) {
    if (match(t)) { cache.removeAll(['mgr_' + t.t, 'ses_' + t.t]); n++; } else keep.push(t);
  });
  PropertiesService.getScriptProperties().setProperty('ADMIN_TOKENS', JSON.stringify(keep));
  return n;
}

// ─── Acciones admin* del Hub ───────────────────────────────────────
function adminRoute_(a, p, body, token, isAdm) {
  if (!isAdm) return { error: 'Tu sesión venció. Entra otra vez con tu PIN.', code: 'AUTH' };
  var q = function (k) { return body[k] !== undefined ? body[k] : p[k]; };
  if (a === 'adminWho') {
    var info = adminInfo_();
    return { ok: true, user: { name: info.name, owner: info.owner, firma: info.firma, manager: true }, admins: adminNames_() };
  }
  if (a === 'adminAudit') return audRead_({ days: q('days'), quien: q('quien'), modulo: q('modulo'), q: q('q') });
  if (a === 'adminLogout') {
    CacheService.getScriptCache().removeAll(['mgr_' + token, 'ses_' + token]);
    adminDropTokens_(function (t) { return t.t === token; });
    audWrite_([adminMe_(), 'Admin', 'Acceso', 'Salió del Hub', '', '', 'OK']);
    return { ok: true };
  }
  if (a === 'adminLogoutOthers') {
    if (!adminIsOwner_()) return { error: 'Solo ' + ADMIN_OWNER + ' puede cerrar las sesiones de los demás.' };
    var n = adminDropTokens_(function (t) { return t.t !== token; });
    audWrite_([adminMe_(), 'Admin', 'Acceso', 'Cerró las demás sesiones de administrador', '', n + ' sesión(es)', 'OK']);
    return { ok: true, closed: n };
  }
  return { error: 'Acción desconocida: ' + a };
}

// ─── Historial de cambios (hoja Auditoria) ─────────────────────────
// Solo se guardan los cambios (no las consultas). Las acciones automáticas se guardan solo si cambiaron algo.
var AUD_SKIP = { segSinLineaSync: 1, segSinLineaMark: 1, aiAsk: 1, aiParse: 1, aiDraft: 1, aiStatus: 1, prosLogin: 1, segList: 1,
  socGet: 1, nomGet: 1, repGet: 1, socLinks: 1, posOffers: 1, posPending: 1, posRecent: 1, prosMatch: 1, prosCheck: 1, escLoad: 1, escDispRows: 1 };
var AUD_AUTO = { credScan: 'cambios', importActivations: 'added' };   // se guardan solo si este campo trae algo
var AUD_LABELS = {
  repLogin: 'Entró al Hub', recordSale: 'Registró venta', voidSale: 'Canceló venta', receiveStock: 'Recibió inventario',
  receiveSerializedItem: 'Recibió equipo / SIM', updateProduct: 'Editó producto', deleteProduct: 'Borró producto',
  saveActivation: 'Guardó activación', deleteActivation: 'Borró activación', importActivations: 'Importó activaciones de Gmail',
  ignoreMobileEmail: 'Marcó correo móvil', actRepSave: 'Registró línea', actRepLineSave: 'Registró línea', actRepDelete: 'Borró línea', actRepPay: 'Cambió pago de línea',
  actRepOffer: 'Registró línea ofrecida', actRepDismissLine: 'Descartó línea', posDismissLine: 'Descartó línea', posOffer: 'Registró oferta de línea',
  credSet: 'Cambió crédito de venta', credScan: 'Acreditó ventas automáticamente',
  escSave: 'Guardó pendiente', escDone: 'Marcó pendiente', escDelete: 'Borró pendiente', escTop3: 'Escogió sus 3 prioridades',
  escMove: 'Movió pendientes de fecha', escInbox: 'Atendió la Bandeja', escNoteSave: 'Guardó nota', escNoteDelete: 'Borró nota',
  repDeskDone: 'Terminó pendiente que le asignaron', escSend: 'Mandó correo', escDispFile: 'Descargó formato de disputa', escContactSave: 'Guardó contacto', escContactDelete: 'Borró contacto', aiLimit: 'Cambió límite de Claude',
  prosAdd: 'Registró prospecto', prosUpdate: 'Editó prospecto', prosContact: 'Registró contacto con prospecto', prosDelete: 'Borró prospecto',
  prosSold: 'Marcó prospecto vendido', prosReview: 'Revisó venta de prospecto',
  segInit: 'Inició seguimiento', segSave: 'Guardó seguimiento', segTask: 'Agendó seguimiento', segDone: 'Completó seguimiento', segClose: 'Cerró seguimiento',
  nomSaveHours: 'Guardó horas', nomSaveStatus: 'Cambió estado de nómina', nomSaveConfig: 'Cambió configuración de nómina', nomClose: 'Cerró periodo de nómina', nomReopen: 'Reabrió periodo de nómina',
  socSavePartner: 'Guardó socio', socDeletePartner: 'Borró socio', socSaveReferral: 'Guardó referido', socDeleteReferral: 'Borró referido',
  socPay: 'Registró pago a socio', socUndoPay: 'Deshizo pago a socio', socChargeback: 'Registró chargeback de socio', socPaidToMe: 'Marcó pago recibido',
  socSaveConfig: 'Cambió configuración de socios', socLink: 'Generó liga de socio', repSave: 'Subió reporte de Cellmart'
};
var AUD_SECRET = /^(pin|mt|token|key|apikey|api_key|password|clave)$/i;

function audModule_(a) {
  if (/^esc/.test(a)) return 'Mi Escritorio';
  if (/^ai/.test(a)) return 'Claude';
  if (/^pros/.test(a)) return 'Prospectos';
  if (/^seg/.test(a)) return 'Seguimiento';
  if (/^nom|^actRepPay$|^pos(Dismiss|Offer)/.test(a)) return 'Nómina';
  if (/Activation|^actRep|MobileEmail/.test(a)) return 'Activaciones';
  if (/^soc/.test(a)) return 'Socios';
  if (/^cred/.test(a)) return 'Crédito';
  if (/^(recordSale|voidSale)$/.test(a)) return 'Punto de venta';
  if (/^(receiveStock|receiveSerializedItem|updateProduct|deleteProduct)$/.test(a)) return 'Inventario';
  if (/Login$/.test(a)) return 'Acceso';
  if (/^rep/.test(a)) return 'Reportes';
  return 'Otro';
}
function audIsRead_(a) {
  return !a || AUD_SKIP[a] || /^(get|list)/.test(a) || /(List|Load|Get|Check|Status|Pending|Receipts|Recent)$/.test(a);
}

function audMaybeLog_(a, p, body, isAdm, sesName, out) {
  if (audIsRead_(a)) return;
  var res = {};
  try { res = JSON.parse(out.getContent()) || {}; } catch (e) { res = {}; }
  if (isAdm) adminFixEnteredBy_(a, audPayload_(p, body), res);
  if (AUD_AUTO[a]) {
    var v = res[AUD_AUTO[a]];
    if (!(Array.isArray(v) ? v.length : Number(v) > 0)) return;
  }
  var who = sesName || String(p.user || body.user || body.employee || '') || '?';
  var rol = isAdm ? 'Admin' : (sesName || p.user || body.user ? 'Asesora' : '—');
  var data = audPayload_(p, body);
  var reg = audRecord_(data, res), label = audLabel_(data, res);
  if (label && reg.indexOf(label) < 0) reg = reg ? label + ' · ' + reg : label;
  var detail = audDetail_(a, data, res);
  var result = res.error ? 'Error: ' + String(res.error).slice(0, 200) : (res.ok === false ? 'Rechazado' : 'OK');
  if (a === 'repLogin' && result !== 'OK') detail = 'PIN incorrecto';
  var accion = AUD_LABELS[a] || a;
  if (a === 'escDone') accion = data.done === false ? 'Reabrió pendiente' : 'Marcó pendiente como hecho';
  audWrite_([who, rol, audModule_(a), accion, reg, detail, result]);
}
// Activaciones.gs anota "EnteredBy: Joel" en las activaciones nuevas que mete un administrador;
// aquí se corrige al nombre de quien la registró (sin tener que cambiar Activaciones.gs).
function adminFixEnteredBy_(a, d, res) {
  if (a !== 'saveActivation' || d.ID || res.error || !res.ID || res.EnteredBy !== 'Joel' || adminMe_() === 'Joel') return;
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Activations');
    var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var cId = hdr.indexOf('ID'), cBy = hdr.indexOf('EnteredBy');
    if (cId < 0 || cBy < 0) return;
    var last = sh.getLastRow(), from = Math.max(2, last - 50);
    var ids = sh.getRange(from, cId + 1, last - from + 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === String(res.ID)) { sh.getRange(from + i, cBy + 1).setValue(adminMe_()); res.EnteredBy = adminMe_(); return; }
    }
  } catch (e) {}
}

// Junta lo que se mandó (parámetros + body + data en JSON), sin PINs ni sesión.
function audPayload_(p, body) {
  var o = {};
  var add = function (src) {
    Object.keys(src || {}).forEach(function (k) {
      if (k === 'action' || AUD_SECRET.test(k)) return;
      var v = src[k];
      if (typeof v === 'string' && /^\s*[\[{]/.test(v)) { try { v = JSON.parse(v); } catch (e) {} }
      o[k] = v;
    });
  };
  add(p); add(body);
  ['data', 'item', 'note', 'contact', 'partner', 'referral', 'config'].forEach(function (k) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) { var inner = o[k]; delete o[k]; add(inner); }
  });
  return o;
}
function audRecord_(d, res) {
  var keys = ['ID', 'id', 'SaleID', 'saleId', 'AccountNumber', 'cuenta', 'Barcode', 'barcode', 'serial', 'Phone', 'phone', 'Telefono'];
  var src = [d, res.item || {}, res.rec || {}, res];
  for (var s = 0; s < src.length; s++) for (var i = 0; i < keys.length; i++) {
    var v = src[s][keys[i]];
    if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') return String(v).slice(0, 60);
  }
  if (Array.isArray(d.ids) && d.ids.length) return d.ids.slice(0, 5).join(', ') + (d.ids.length > 5 ? '…' : '');
  if (Array.isArray(d.itemIds) && d.itemIds.length) return d.itemIds.slice(0, 5).join(', ');
  return '';
}
// Nombre legible del registro (título del pendiente, cliente, producto…)
function audLabel_(d, res) {
  var keys = ['Titulo', 'titulo', 'CustomerName', 'customerName', 'Nombre', 'nombre', 'Name', 'name'];
  var src = [res.item || {}, res.rec || {}, d, res];
  for (var s = 0; s < src.length; s++) for (var i = 0; i < keys.length; i++) {
    var v = src[s][keys[i]];
    if (v && typeof v !== 'object') return String(v).slice(0, 80);
  }
  return '';
}
function audDetail_(a, d, res) {
  if (a === 'escSend') return 'Para: ' + (d.to || '') + (d.cc ? ' · CC: ' + d.cc : '') + ' · "' + String(d.subject || '').slice(0, 120) + '"' + (d.draftOnly ? ' (borrador)' : '') +
    (Array.isArray(res.adjuntos) && res.adjuntos.length ? ' · 📎 ' + res.adjuntos.join(', ') : '');
  if (a === 'escDispFile') return '';
  if (a === 'recordSale') {
    var items = Array.isArray(d.items) ? d.items : [];
    return [d.customerName || d.CustomerName || '', items.length ? items.length + ' artículo(s)' : '', d.total !== undefined ? '$' + d.total : '', d.payment || ''].filter(String).join(' · ');
  }
  if (a === 'credScan' && Array.isArray(res.cambios)) return res.cambios.map(function (c) { return (c.cliente || '') + ' → ' + (c.a || ''); }).join(', ').slice(0, 900);
  if (a === 'importActivations') return (res.added || 0) + ' activación(es) nueva(s)';
  if (a === 'escDone' || a === 'escDelete' || a === 'escNoteDelete' || a === 'escContactDelete') return '';
  var skip = { user: 1, employee: 1, store: 1 };
  var parts = [];
  Object.keys(d).forEach(function (k) {
    if (skip[k]) return;
    var v = d[k];
    if (v === '' || v === null || v === undefined) return;
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v).replace(/\s+/g, ' ');
    parts.push(k + ': ' + (v.length > 120 ? v.slice(0, 117) + '…' : v));
  });
  var t = parts.join(' · ');
  return t.length > 1500 ? t.slice(0, 1497) + '…' : t;
}

function audSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(AUD_SHEET);
  if (!sh) {
    sh = ss.insertSheet(AUD_SHEET);
    sh.getRange(1, 1, sh.getMaxRows(), AUD_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, AUD_HEADERS.length).setValues([AUD_HEADERS]).setFontWeight('bold')
      .setBackground('#0A1F3C').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    [150, 90, 70, 120, 220, 140, 520, 120].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  }
  return sh;
}
/** row = [Usuario, Rol, Modulo, Accion, Registro, Detalle, Resultado] (la fecha se pone sola). */
function audWrite_(row) {
  try {
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
    audSheet_().appendRow([now].concat(row.map(function (v) { return String(v === undefined || v === null ? '' : v); })));
  } catch (e) { /* sin historial, pero el Hub sigue */ }
}

function audRead_(f) {
  var days = Math.min(Math.max(Number(f.days) || 7, 1), 366);
  var sh = audSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [], users: [], modules: [], total: 0 };
  var n = Math.min(last - 1, 6000);
  var vals = sh.getRange(last - n + 1, 1, n, AUD_HEADERS.length).getDisplayValues();
  var since = Utilities.formatDate(new Date(Date.now() - days * 86400000), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
  var quien = String(f.quien || ''), mod = String(f.modulo || ''), q = String(f.q || '').toLowerCase().trim();
  var users = {}, mods = {}, rows = [], total = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    var r = vals[i];
    if (r[0] < since) break;
    users[r[1]] = 1; mods[r[3]] = 1;
    if (quien && r[1] !== quien) continue;
    if (mod && r[3] !== mod) continue;
    if (q && r.join(' ').toLowerCase().indexOf(q) < 0) continue;
    total++;
    if (rows.length < 500) rows.push({ Fecha: r[0], Usuario: r[1], Rol: r[2], Modulo: r[3], Accion: r[4], Registro: r[5], Detalle: r[6], Resultado: r[7] });
  }
  return { ok: true, rows: rows, total: total, users: Object.keys(users).sort(), modules: Object.keys(mods).sort(), days: days };
}


// ─── Líneas por registrar: ventas con SIM y sin teléfono (el cliente trae su teléfono / BYOD) ──
// Nomina.gs solo avisa de ventas con teléfono; aquí se agregan las de SIM sola a la misma lista
// (📱 Líneas por registrar en la caja y en Mis líneas). Usa las funciones de Nomina.gs.
function simIsSim_(i) { return /sim/i.test(String(i.category || '')) || /\bsim\b/i.test(String(i.name || '')); }
function simAddPending_(out, onlyRep) {
  try {
    var res = JSON.parse(out.getContent());
    if (!res || !res.ok || !Array.isArray(res.pending)) return out;
    var extra = simPending_(onlyRep);
    if (!extra.length) return out;
    var have = {}; res.pending.forEach(function (x) { have[x.SaleID] = 1; });
    res.pending = res.pending.concat(extra.filter(function (x) { return !have[x.SaleID]; }))
      .sort(function (a, b) { return a.Date < b.Date ? -1 : 1; });
    return adminJson_(res);
  } catch (e) { return out; }
}
function simPending_(onlyRep) {
  if (typeof cajaSales_ !== 'function' || typeof nomReadOpt_ !== 'function') return [];
  var digits = function (v) { return String(v || '').replace(/\D/g, ''); };
  var day = function (v) { return typeof nomYmd_ === 'function' ? nomYmd_(v) : String(v || '').slice(0, 10); };
  var diff = function (a, b) { return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000); };
  var bySale = {}, serials = {}, byAcct = {}, byPhone = {};
  nomReadOpt_('Activations').forEach(function (a) {
    if (a.PosSaleID) bySale[String(a.PosSaleID)] = 1;
    (String(a.IMEIs || '') + ' ' + String(a.Notes || '')).split(/[^\d]+/).forEach(function (x) { if (x.length >= 14) serials[x] = 1; });
    var d = day(a.OrderDate), ac = digits(a.AccountNumber), ph = digits(a.Phone).slice(-10);
    if (ac) (byAcct[ac] = byAcct[ac] || []).push(d);
    if (ph.length === 10) (byPhone[ph] = byPhone[ph] || []).push(d);
  });
  var near = function (list, d0) { return (list || []).some(function (d) { var k = diff(d0, d); return k >= -1 && k <= 7; }); };
  var dismissed = {};
  try { nomReadOpt_(NOM_SHEETS.dismiss.name).forEach(function (d) { dismissed[String(d.SaleID)] = 1; }); } catch (e) {}
  var isPhone = typeof cajaIsPhone_ === 'function' ? cajaIsPhone_ : function () { return false; };
  var out = [];
  cajaSales_(45).forEach(function (s) {
    if (/void/i.test(s.Status) || dismissed[s.SaleID] || bySale[s.SaleID]) return;
    if (onlyRep && s.Employee !== onlyRep) return;
    if (s.Items.some(function (i) { return isPhone(i.category); })) return;   // esas ya las avisa Nomina.gs
    var sims = s.Items.filter(simIsSim_);
    if (!sims.length) return;
    if (sims.every(function (i) { return serials[digits(i.barcode)]; })) return;
    var d0 = s.Date.slice(0, 10);
    if (s.SpectrumAccountNumber && near(byAcct[s.SpectrumAccountNumber], d0)) return;
    var ph = digits(s.CustomerPhone).slice(-10);
    if (ph.length === 10 && near(byPhone[ph], d0)) return;
    out.push({ SaleID: s.SaleID, Date: s.Date, Employee: s.Employee, CustomerName: s.CustomerName, CustomerPhone: s.CustomerPhone,
      AccountName: s.SpectrumAccountName, AccountNumber: s.SpectrumAccountNumber, sim: true,
      Phones: sims.map(function (i) { return { name: i.name, imei: String(i.barcode || ''), gift: !!i.gift, qty: +i.qty || 1, sim: true }; }),
      gift: sims.some(function (i) { return i.gift; }) });
  });
  return out;
}


// ─── Recordatorio al entrar (asesoras) ─────────────────────────────
// Lo que la asesora tiene pendiente: seguimientos vencidos y de hoy, líneas por registrar,
// clientes con internet sin línea y los pendientes que un administrador le asignó en Mi Escritorio.
function repResumen_(p) {
  var me = prosAuth_(p);   // usuario + PIN de 6 dígitos (Prospectos.gs)
  var out = { ok: true, name: me.name, vencidos: [], hoy: [], lineas: [], pendientes: [], sinLinea: 0 };
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd');
  try {
    var d = segOpenTasks_();
    d.open.filter(function (t) { return t.Asesora === me.name; }).forEach(function (t) {
      var pr = d.pros[t.ProspectoID] || {}, inf = d.info[t.ProspectoID] || {};
      var x = { nombre: pr.Nombre || '', telefono: pr.Telefono || '', tipo: t.Tipo || '', fecha: String(t.Fecha || '').slice(0, 10),
        hora: t.Hora || '', paso: t.Paso || '', temp: inf.Temperatura || '' };
      if (x.fecha && x.fecha < today) out.vencidos.push(x); else if (x.fecha === today) out.hoy.push(x);
    });
    var srt = function (a, b) { return (a.fecha + (a.hora || '99')).localeCompare(b.fecha + (b.hora || '99')); };
    out.vencidos.sort(srt); out.hoy.sort(srt);
  } catch (e) { out.segError = String(e.message || e); }
  try {
    var pend = cajaPending_(me.name).pending || [];
    pend = pend.concat(simPending_(me.name));
    out.lineas = pend.map(function (x) { return { venta: x.SaleID, fecha: x.Date, cliente: x.AccountName || x.CustomerName || '', sim: !!x.sim, regalo: !!x.gift }; });
  } catch (e) {}
  try { var sl = segSinLinea_({ name: me.name, manager: false }); out.sinLinea = (Array.isArray(sl) ? sl : []).filter(function (x) { return !x.estado; }).length; } catch (e) {}
  try {
    escRead_(ESC_TASKS, ESC_TASK_HEADERS).rows.forEach(function (r) {
      if (r.Estado !== 'Abierto' || r.Asignado !== me.name || r.Tipo === 'Espera') return;
      out.pendientes.push({ id: r.ID, titulo: r.Titulo, fecha: r.Fecha || '', prioridad: r.Prioridad || '', notas: String(r.Notas || '').slice(0, 300), de: r.CreadoPor || 'Joel' });
    });
    out.pendientes.sort(function (a, b) { return (a.fecha || '9').localeCompare(b.fecha || '9'); });
  } catch (e) {}
  return out;
}
/** La asesora marca como hecho un pendiente que le asignaron (solo los suyos). */
function repDeskDone_(p) {
  var me = prosAuth_(p);
  var id = String(p.id || '');
  var r = escRead_(ESC_TASKS, ESC_TASK_HEADERS).rows.filter(function (x) { return x.ID === id; })[0];
  if (!r || r.Asignado !== me.name) throw new Error('Ese pendiente no es tuyo.');
  ADMIN_ME_ = me.name;
  return escLocked_(function () { return escDone_(id, true); });
}
