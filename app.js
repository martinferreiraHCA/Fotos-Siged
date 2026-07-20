const PHOTO_WIDTH = 100;
const PHOTO_HEIGHT = 100;
const HD_WIDTH = 1080;
const HD_HEIGHT = 1080;
const HD_FOLDER_NAME = "imagenes de estudiantes alta resolución";
// Versión de peso reducido (tamaño promedio) nombrada solo con la cédula,
// pensada para subir a sistemas externos sin sobrecargarlos.
const MID_WIDTH = 600;
const MID_HEIGHT = 600;
const MID_QUALITY = 0.8;
const CEDULA_FOLDER_NAME = "imagenes por cédula";

/* ── Toast notifications ──────────────────────────── */
function toast(message, type = "info", duration = 3200) {
  const container = document.getElementById("toast-container");
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span>${icons[type] ?? icons.info}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast--out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, duration);
}

const state = {
  rows: [],
  groups: [],
  grupoActual: "",
  estudiantes: [],
  seleccion: null,
  fotos: new Map(), // documento => dataURL (100x100)
  fotosHD: new Map(), // documento => dataURL (1080x1080)
  fotosCedula: new Map(), // documento => dataURL (600x600, peso reducido)
  stream: null,
  currentDevices: [],
  // Google Drive
  driveToken:    null,
  driveTokenExpira: null, // timestamp de vencimiento del token
  driveUser:     null,
  driveFolderId: null,
  driveGrupoId:  null,
  driveFiles:    new Map(), // documento => fileId en Drive
  driveHDFolderId: null,
  driveHDGrupoId:  null,
  driveCedulaFolderId: null,
  driveCedulaGrupoId:  null
};

const helpText = {
  "panel-info":        { title: "Información general",     body: "Muestra resumen del grupo: cuántos estudiantes hay, cuántos tienen foto y el progreso general." },
  "ultima-foto":       { title: "Última foto tomada",      body: "Presenta una miniatura de la foto más reciente y el nombre/documento del estudiante asociado." },
  "nivel":             { title: "Nivel educativo",         body: "Selecciona Primaria o Secundaria. Cada nivel guarda su propia URL de datos. El formato de Secundaria incluye el campo 'Jura. Band.' que no está en Primaria." },
  "activar-camara":    { title: "Activar cámara",          body: "Solicita permisos de cámara al navegador y habilita la vista previa en tiempo real." },
  "cargar-csv":        { title: "Cargar archivo de datos", body: "Lee un archivo CSV o XLSX local (sin subirlo a internet), detecta grupos y prepara la lista de estudiantes. Soporta el formato de exportación SIGED." },
  "seleccionar-grupo": { title: "Seleccionar grupo",       body: "Filtra estudiantes por grupo y reinicia la vista para trabajar solo con ese grupo." },
  "guardar-foto":      { title: "Guardar foto",            body: "Captura el frame actual de la cámara y genera tres versiones: 100×100 px para SIGED, 1080×1080 px en alta resolución (nombre_apellido_cédula) y 600×600 px de peso reducido nombrada solo con la cédula." },
  "comprimir":         { title: "Generar ZIP del grupo",   body: "Genera un ZIP con tres carpetas: SIGED (100×100), imágenes de estudiantes alta resolución (1080×1080) e imágenes por cédula (600×600, peso reducido para subir a otros sistemas)." },
  "cargar-url":        { title: "URL fija de datos",       body: "Pega el link de tu Google Sheets, un archivo XLSX en Google Drive, o un CSV en GitHub Raw. La app convierte el link automáticamente y guarda la URL por nivel (Primaria/Secundaria) en el navegador." }
};

const $ = (id) => document.getElementById(id);
const STORAGE_URL_KEY    = "siged_csv_url"; // legacy — migrated to per-level keys
const STORAGE_FOTOS_KEY  = "siged_fotos";
const STORAGE_GCLIENT_KEY = "siged_google_client_id";
const STORAGE_NIVEL_KEY   = "siged_nivel";
const STORAGE_URL_PRIMARIA   = "siged_url_primaria";
const STORAGE_URL_SECUNDARIA = "siged_url_secundaria";
const DRIVE_ROOT          = "SIGED Fotos";
const DEFAULT_CLIENT_ID   = "263672487463-bf0e1fn8k66tnvsfld7dtnmmd5ag6t46.apps.googleusercontent.com";
const DRIVE_SCOPE  = "https://www.googleapis.com/auth/drive.file";
const DRIVE_SCOPES = `${DRIVE_SCOPE} profile email`;
let tokenClient = null;
let pendingToken = null;      // solicitud de token en curso { resolve, reject }
let renovacionEnCurso = null; // promesa compartida para no pedir dos tokens a la vez

function sanitizeDoc(value) {
  return String(value ?? "").replace(/[.-]/g, "").trim();
}

// Genera una versión de peso reducido (MID_WIDTH x MID_HEIGHT JPEG) a partir
// de un dataURL existente. Útil para fotos capturadas antes de esta versión.
function generarVersionCedula(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = MID_WIDTH;
      c.height = MID_HEIGHT;
      c.getContext("2d").drawImage(img, 0, 0, MID_WIDTH, MID_HEIGHT);
      resolve(c.toDataURL("image/jpeg", MID_QUALITY));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function generarNombreHD(nombre, documento) {
  const nombreLimpio = String(nombre ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "_");
  const doc = sanitizeDoc(documento);
  return `${nombreLimpio}_${doc}`;
}

/* ── URL helpers ──────────────────────────────────── */
function esFormatoXlsx(url) {
  url = url.trim();
  if (url.match(/\/spreadsheets\/d\//)) return true;
  if (url.match(/drive\.google\.com\/file\/d\//)) return true;
  if (url.match(/\.xlsx$/i) || url.match(/\.xls$/i)) return true;
  return false;
}

function normalizarUrl(url) {
  url = url.trim();

  // Google Sheets: exportar como XLSX para preservar formato de cabeceras
  const sheetsMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetsMatch) {
    const id = sheetsMatch[1];
    const gidMatch = url.match(/[#?&]gid=(\d+)/);
    const gid = gidMatch ? `&gid=${gidMatch[1]}` : "";
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx${gid}`;
  }

  // Google Drive: archivo directo → URL de descarga
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }

  // GitHub: URL de blob → URL raw
  const ghMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)/);
  if (ghMatch) {
    return `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}`;
  }

  return url;
}

function obtenerUrlKeyNivel() {
  const nivel = $("nivel")?.value;
  return nivel === "secundaria" ? STORAGE_URL_SECUNDARIA : STORAGE_URL_PRIMARIA;
}

function actualizarStatusUrl(url) {
  const el = $("url-status");
  const btn = $("btn-olvidar-url");
  if (url) {
    el.textContent = `✓ URL configurada: ${url.length > 60 ? url.slice(0, 57) + "…" : url}`;
    el.className = "field-status field-status--ok";
    btn.hidden = false;
  } else {
    el.textContent = "";
    el.className = "field-status";
    btn.hidden = true;
  }
}

/* ── Persistencia de sesión (fotos en localStorage) ── */
function guardarSesion() {
  try {
    const obj = {};
    state.fotos.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(STORAGE_FOTOS_KEY, JSON.stringify(obj));
    actualizarInfoSesion();
  } catch {
    toast("Almacenamiento lleno. Exporta el ZIP y libera espacio.", "error", 5000);
  }
}

function restaurarSesion() {
  try {
    const raw = localStorage.getItem(STORAGE_FOTOS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    Object.entries(obj).forEach(([k, v]) => state.fotos.set(k, v));
  } catch {
    // datos corruptos — ignorar silenciosamente
  }
}

function actualizarInfoSesion() {
  const count = state.fotos.size;
  const el = $("sesion-count");
  if (!el) return;
  if (count > 0) {
    el.textContent = `${count} foto${count !== 1 ? "s" : ""} guardadas en este navegador`;
    el.style.color = "var(--success)";
  } else {
    el.textContent = "Sin fotos guardadas aún";
    el.style.color = "var(--muted)";
  }
  $("btn-limpiar-sesion").disabled = count === 0;
}

function limpiarSesion() {
  if (!confirm(`¿Borrar las ${state.fotos.size} fotos guardadas en este navegador? Esta acción no se puede deshacer.`)) return;
  state.fotos.clear();
  state.fotosHD.clear();
  state.fotosCedula.clear();
  localStorage.removeItem(STORAGE_FOTOS_KEY);
  limpiarSesionHD();
  actualizarInfoSesion();
  renderEstudiantes();
  actualizarPendientesYStats();
  $("ultima-foto").getContext("2d").clearRect(0, 0, 150, 150);
  $("ultimo-estudiante").textContent = "Ninguna foto tomada.";
  actualizarStudentPreview();
  toast("Sesión limpiada. Todas las fotos borradas del navegador.", "info");
}

/* ── IndexedDB para fotos HD y por cédula ────────── */
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("siged_fotos_hd", 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("fotos_hd")) db.createObjectStore("fotos_hd");
      if (!db.objectStoreNames.contains("fotos_cedula")) db.createObjectStore("fotos_cedula");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function guardarSesionHD() {
  try {
    const db = await abrirDB();
    const tx = db.transaction(["fotos_hd", "fotos_cedula"], "readwrite");
    const storeHD = tx.objectStore("fotos_hd");
    state.fotosHD.forEach((v, k) => storeHD.put(v, k));
    const storeCedula = tx.objectStore("fotos_cedula");
    state.fotosCedula.forEach((v, k) => storeCedula.put(v, k));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch { /* IndexedDB no disponible — ignorar */ }
}

async function restaurarSesionHD() {
  try {
    const db = await abrirDB();
    const tx = db.transaction(["fotos_hd", "fotos_cedula"], "readonly");
    const reqHDAll = tx.objectStore("fotos_hd").getAll();
    const reqHDKeys = tx.objectStore("fotos_hd").getAllKeys();
    const reqCedAll = tx.objectStore("fotos_cedula").getAll();
    const reqCedKeys = tx.objectStore("fotos_cedula").getAllKeys();
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    for (let i = 0; i < reqHDKeys.result.length; i++) {
      state.fotosHD.set(reqHDKeys.result[i], reqHDAll.result[i]);
    }
    for (let i = 0; i < reqCedKeys.result.length; i++) {
      state.fotosCedula.set(reqCedKeys.result[i], reqCedAll.result[i]);
    }
    db.close();
  } catch { /* IndexedDB no disponible — ignorar */ }
}

async function limpiarSesionHD() {
  try {
    const db = await abrirDB();
    const tx = db.transaction(["fotos_hd", "fotos_cedula"], "readwrite");
    tx.objectStore("fotos_hd").clear();
    tx.objectStore("fotos_cedula").clear();
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch { /* IndexedDB no disponible — ignorar */ }
}

/* ── Google Drive / Auth ──────────────────────────── */
function obtenerClientId() {
  return localStorage.getItem(STORAGE_GCLIENT_KEY) ?? DEFAULT_CLIENT_ID;
}

function inicializarGIS(clientId) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPES,
    callback: async (response) => {
      const pend = pendingToken;
      if (response.error) {
        const msgs = {
          popup_closed_by_user: "Cerraste el popup de Google antes de completar el login.",
          popup_failed_to_open:  "El popup fue bloqueado. Permite ventanas emergentes para este sitio y vuelve a intentarlo.",
          access_denied:         "Acceso denegado. Debes aceptar los permisos de Google Drive.",
          invalid_client:        "Client ID inválido. Revisá la configuración en Google Cloud Console.",
        };
        const msg = msgs[response.error] ?? `Error de autenticación: ${response.error}`;
        if (pend) pend.reject(new Error(msg));
        else toast(msg, "error", 7000);
        return;
      }
      // Consentimiento granular: Google permite desmarcar el permiso de Drive
      // en la pantalla de login. Sin ese permiso toda subida falla con
      // "insufficient authentication scopes", así que lo verificamos acá.
      if (!google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
        const msg = "Google no otorgó el permiso de Drive. Vuelve a conectar y deja marcada la casilla de acceso a Drive en la pantalla de Google.";
        if (pend) pend.reject(new Error(msg));
        else toast(msg, "error", 9000);
        return;
      }
      state.driveToken = response.access_token;
      // Renovar 2 minutos antes del vencimiento real (~1 hora)
      const vidaSeg = Math.max((Number(response.expires_in) || 3600) - 120, 60);
      state.driveTokenExpira = Date.now() + vidaSeg * 1000;
      if (pend) { pend.resolve(response.access_token); return; }
      await obtenerInfoUsuario().catch(() => {});
      actualizarUIUsuario();
      if (state.grupoActual) sincronizarFotosDeDrive(state.grupoActual).catch(() => {});
    },
    error_callback: (err) => {
      const msgs = {
        popup_closed:          "Cerraste el popup de Google antes de completar el login.",
        popup_failed_to_open:  "El popup fue bloqueado. Permite ventanas emergentes para este sitio y vuelve a intentarlo.",
      };
      const msg = msgs[err?.type] ?? `Error de Google: ${err?.type ?? err?.message ?? "desconocido"}`;
      if (pendingToken) pendingToken.reject(new Error(msg));
      else toast(msg, "error", 7000);
    }
  });
}

// Pide un token a GIS y lo devuelve como promesa. promptMode "" intenta
// renovar sin popup; "consent" fuerza la pantalla de permisos.
function solicitarToken(promptMode = "") {
  if (!window.google?.accounts?.oauth2) {
    return Promise.reject(new Error("Google Sign-In no está disponible. Recarga la página."));
  }
  if (!tokenClient) inicializarGIS(obtenerClientId());
  return new Promise((resolve, reject) => {
    const finalizar = (token, err) => {
      clearTimeout(timer);
      if (pendingToken?.finalizar === finalizar) pendingToken = null;
      if (err) reject(err); else resolve(token);
    };
    // GIS no siempre invoca el callback (p. ej. popup cerrado por el sistema):
    // timeout de seguridad para no dejar la promesa colgada.
    const timer = setTimeout(() => finalizar(null, new Error(
      promptMode
        ? "Google no respondió. Revisa que el popup no esté bloqueado y vuelve a intentar."
        : "No se pudo renovar la sesión de Google en segundo plano."
    )), promptMode ? 180000 : 20000);
    if (pendingToken) pendingToken.reject(new Error("Solicitud de token reemplazada por una nueva."));
    pendingToken = {
      resolve: (t) => finalizar(t, null),
      reject: (e) => finalizar(null, e),
      finalizar
    };
    try {
      tokenClient.requestAccessToken({ prompt: promptMode });
    } catch (e) {
      finalizar(null, e);
    }
  });
}

// Garantiza un token vigente antes de cada llamada a Drive: si venció,
// intenta renovarlo en silencio y, si eso falla, con la pantalla de permisos.
async function asegurarToken() {
  if (state.driveToken && Date.now() < (state.driveTokenExpira ?? 0)) return state.driveToken;
  if (!state.driveToken && state.driveTokenExpira == null) {
    throw new Error('No hay sesión de Google activa. Pulsa "Conectar Drive".');
  }
  if (!renovacionEnCurso) {
    renovacionEnCurso = solicitarToken("")
      .catch(() => solicitarToken("consent"))
      .finally(() => { renovacionEnCurso = null; });
  }
  return renovacionEnCurso;
}

async function obtenerInfoUsuario() {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${state.driveToken}` }
  });
  state.driveUser = await res.json();
}

async function loginConGoogle() {
  const clientId = obtenerClientId();
  if (!clientId) { $("config-drive-modal").showModal(); return; }
  if (!window.google?.accounts?.oauth2) {
    toast("No se pudo cargar Google Sign-In. Recarga la página e intenta de nuevo.", "error", 6000);
    return;
  }
  try {
    // "consent" siempre muestra la pantalla de permisos → más confiable
    await solicitarToken("consent");
    await obtenerInfoUsuario().catch(() => {});
    actualizarUIUsuario();
    toast("Google Drive conectado correctamente.", "success");
    if (state.grupoActual) sincronizarFotosDeDrive(state.grupoActual).catch(() => {});
  } catch (e) {
    toast(e.message, "error", 8000);
  }
}

function logoutGoogle() {
  if (state.driveToken) google.accounts.oauth2.revoke(state.driveToken, () => {});
  state.driveToken    = null;
  state.driveTokenExpira = null;
  state.driveUser     = null;
  state.driveFolderId = null;
  state.driveGrupoId  = null;
  state.driveHDFolderId = null;
  state.driveHDGrupoId  = null;
  state.driveCedulaFolderId = null;
  state.driveCedulaGrupoId  = null;
  state.driveFiles.clear();
  actualizarUIUsuario();
  toast("Sesión de Google cerrada.", "info");
}

function actualizarUIUsuario() {
  const loggedIn = !!state.driveToken;
  $("btn-login-google").hidden = loggedIn;
  $("user-info").hidden = !loggedIn;
  if (loggedIn && state.driveUser) {
    $("user-name").textContent = state.driveUser.name ?? state.driveUser.email ?? "Usuario";
    const avatar = $("user-avatar");
    if (state.driveUser.picture) { avatar.src = state.driveUser.picture; avatar.hidden = false; }
    else { avatar.hidden = true; }
  }
  actualizarDrivePanel();
}

// ── Drive API helpers ──────────────────────────────
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Todas las llamadas a Drive pasan por acá: agrega el token vigente,
// renueva ante 401, re-pide permisos ante scopes insuficientes y reintenta
// con backoff exponencial ante errores de red, límite de peticiones o 5xx.
async function driveFetch(url, init = {}, reintentos = 3) {
  let ultimoError = null;
  for (let intento = 0; intento <= reintentos; intento++) {
    if (intento > 0) await esperar(Math.min(1000 * 2 ** (intento - 1), 8000));
    const token = await asegurarToken();
    let res;
    try {
      res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
    } catch {
      ultimoError = new Error("Sin conexión con Google Drive. Verifica tu internet.");
      continue;
    }
    if (res.ok) return res;

    const cuerpo = await res.json().catch(() => ({}));
    const mensaje = cuerpo.error?.message ?? `HTTP ${res.status}`;

    if (res.status === 401) {
      // Token inválido o revocado: forzar renovación en la próxima vuelta
      state.driveToken = null;
      state.driveTokenExpira = 0;
      ultimoError = new Error("La sesión de Google expiró y no se pudo renovar.");
      continue;
    }
    if (res.status === 403 && /insufficient|scope/i.test(mensaje)) {
      // El token existe pero sin permiso de Drive (consentimiento incompleto):
      // volver a pedir permisos mostrando la pantalla de Google.
      state.driveToken = null;
      state.driveTokenExpira = 0;
      try {
        await solicitarToken("consent");
        continue;
      } catch {
        throw new Error('Faltan permisos de Google Drive. Pulsa "Conectar Drive" y deja marcada la casilla de acceso a Drive en la pantalla de Google.');
      }
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      ultimoError = new Error(mensaje);
      continue;
    }
    throw new Error(mensaje);
  }
  throw ultimoError ?? new Error("No se pudo conectar con Google Drive.");
}

async function driveRequest(method, path, body = null, params = {}) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const init = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await driveFetch(url.toString(), init);
  return res.status !== 204 ? res.json() : null;
}

async function encontrarOCrearCarpeta(nombre, parentId = null) {
  let q = `name='${nombre}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const { files = [] } = await driveRequest("GET", "files", null, { q, fields: "files(id)" });
  if (files.length) return files[0].id;
  const carpeta = await driveRequest("POST", "files", {
    name: nombre,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {})
  });
  return carpeta.id;
}

function base64ToBlob(b64, mime = "image/png") {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function subirFotoADrive(doc, dataUrl) {
  if (!state.driveToken || !state.driveGrupoId) return;

  const blob = base64ToBlob(dataUrl.split(",")[1]);
  const existingId = state.driveFiles.get(doc);
  if (existingId) {
    await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
      { method: "PATCH", headers: { "Content-Type": "image/png" }, body: blob }
    );
  } else {
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({
      name: `${doc}.png`, parents: [state.driveGrupoId]
    })], { type: "application/json" }));
    form.append("file", blob);
    const res = await driveFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", body: form }
    );
    const file = await res.json();
    if (file.id) state.driveFiles.set(doc, file.id);
  }
}

async function subirFotoHDADrive(doc, nombre, dataUrl) {
  if (!state.driveToken || !state.driveHDGrupoId) return;

  const nombreArchivo = generarNombreHD(nombre, doc);
  const blob = base64ToBlob(dataUrl.split(",")[1], "image/jpeg");
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({
    name: `${nombreArchivo}.jpg`, parents: [state.driveHDGrupoId]
  })], { type: "application/json" }));
  form.append("file", blob);
  await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    { method: "POST", body: form }
  );
}

async function subirFotoCedulaADrive(doc, dataUrl) {
  if (!state.driveToken || !state.driveCedulaGrupoId) return;

  const blob = base64ToBlob(dataUrl.split(",")[1], "image/jpeg");
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({
    name: `${doc}.jpg`, parents: [state.driveCedulaGrupoId]
  })], { type: "application/json" }));
  form.append("file", blob);
  await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    { method: "POST", body: form }
  );
}

function actualizarDrivePanel() {
  const panel = $("drive-panel");
  if (!state.driveToken) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const pathText = $("drive-path-text");
  if (state.grupoActual && state.driveGrupoId) {
    pathText.textContent = `${DRIVE_ROOT} / ${state.grupoActual}`;
  } else if (state.driveFolderId) {
    pathText.textContent = `${DRIVE_ROOT}`;
  } else {
    pathText.textContent = "Conectado — selecciona un grupo";
  }

  const syncCount = $("drive-sync-count");
  const totalDrive = state.driveFiles.size;
  if (totalDrive > 0) {
    syncCount.textContent = `${totalDrive} foto${totalDrive !== 1 ? "s" : ""} en Drive`;
  } else if (state.grupoActual) {
    syncCount.textContent = "Sin fotos en Drive para este grupo";
    syncCount.style.color = "var(--muted)";
  } else {
    syncCount.textContent = "";
  }
}

async function sincronizarFotosDeDrive(grupoNombre) {
  if (!state.driveToken) return;
  const statusEl = $("drive-status");
  if (statusEl) statusEl.textContent = "Sincronizando…";
  actualizarDrivePanel();
  try {
    if (!state.driveFolderId) {
      state.driveFolderId = await encontrarOCrearCarpeta(DRIVE_ROOT);
    }
    state.driveGrupoId = await encontrarOCrearCarpeta(grupoNombre, state.driveFolderId);
    // Pre-crear carpetas HD para que estén listas al capturar fotos
    if (!state.driveHDFolderId) {
      state.driveHDFolderId = await encontrarOCrearCarpeta(HD_FOLDER_NAME, state.driveFolderId);
    }
    state.driveHDGrupoId = await encontrarOCrearCarpeta(grupoNombre, state.driveHDFolderId);
    if (!state.driveCedulaFolderId) {
      state.driveCedulaFolderId = await encontrarOCrearCarpeta(CEDULA_FOLDER_NAME, state.driveFolderId);
    }
    state.driveCedulaGrupoId = await encontrarOCrearCarpeta(grupoNombre, state.driveCedulaFolderId);
    state.driveFiles.clear();
    actualizarDrivePanel();

    const q = `'${state.driveGrupoId}' in parents and trashed=false and mimeType='image/png'`;
    const { files = [] } = await driveRequest("GET", "files", null, { q, fields: "files(id,name)" });

    let nuevas = 0;
    for (const file of files) {
      const doc = file.name.replace(/\.png$/i, "");
      state.driveFiles.set(doc, file.id);
      if (!state.fotos.has(doc)) {
        const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
        state.fotos.set(doc, await blobToDataUrl(await res.blob()));
        nuevas++;
      }
    }
    if (nuevas > 0) { guardarSesion(); renderEstudiantes(); actualizarPendientesYStats(); }
    if (statusEl) statusEl.textContent = `Drive ✓ · ${files.length} foto${files.length !== 1 ? "s" : ""}`;
    actualizarDrivePanel();
    if (nuevas > 0) toast(`${nuevas} foto${nuevas !== 1 ? "s" : ""} descargada${nuevas !== 1 ? "s" : ""} desde Drive.`, "success");
  } catch (err) {
    if (statusEl) statusEl.textContent = "Error de sincronización";
    toast(`Error al sincronizar con Drive: ${err.message}`, "error", 6000);
  }
}

async function cargarDesdeUrl(url, silencioso = false) {
  const xlsx = esFormatoXlsx(url);
  const urlFinal = normalizarUrl(url);
  if (!silencioso) toast("Cargando datos desde URL…", "info", 2000);
  try {
    let res;
    // Para archivos de Google Drive, usar Drive API si hay sesión activa
    const driveFileMatch = url.trim().match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveFileMatch && state.driveToken) {
      res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFileMatch[1]}?alt=media`);
    } else {
      res = await fetch(urlFinal);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }

    const esSecundaria = $("nivel").value === "secundaria";
    if (xlsx) {
      const buffer = await res.arrayBuffer();
      state.rows = parseXLSX(buffer, esSecundaria);
    } else {
      const text = await res.text();
      state.rows = parseCSV(text, esSecundaria);
    }

    state.groups = [...new Set(state.rows.map((r) => String(r.Grupo).trim()))].filter(Boolean).sort();
    $("grupo").innerHTML = state.groups.map((g) => `<option value="${g}">${g}</option>`).join("");
    if (state.groups.length) {
      $("grupo").value = state.groups[0];
      seleccionarGrupo();
    }
    const key = obtenerUrlKeyNivel();
    localStorage.setItem(key, url);
    $("csv-url").value = url;
    actualizarStatusUrl(url);
    toast(`Datos cargados: ${state.rows.length} estudiantes en ${state.groups.length} grupos.`, "success");
  } catch (err) {
    if (url.match(/drive\.google\.com\/file\/d\//) && !state.driveToken) {
      toast("Para archivos de Google Drive, inicia sesión con Google primero o sube el archivo directamente.", "error", 8000);
    } else {
      toast(`No se pudo cargar los datos: ${err.message}`, "error", 6000);
    }
  }
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((v) => v.trim());
}

function parseCSV(text, concatenarCursoGrupo = false) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const useful = lines.slice(2);
  if (!useful.length) return [];
  const headers = parseCsvLine(useful[0]);
  const idxGrupo = headers.indexOf("Grupo");
  const idxDocumento = headers.indexOf("Documento");
  const idxNombre = headers.indexOf("Nombre");
  const idxCurso = concatenarCursoGrupo ? headers.indexOf("Curso") : -1;
  if ([idxGrupo, idxDocumento, idxNombre].some((idx) => idx < 0)) {
    throw new Error("CSV inválido: requiere columnas Grupo, Documento y Nombre.");
  }
  return useful.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const curso = idxCurso >= 0 ? (cols[idxCurso] ?? "").trim() : "";
    const grupo = (cols[idxGrupo] ?? "").trim();
    return {
      Grupo: curso ? `${curso} ${grupo}` : grupo,
      Documento: cols[idxDocumento] ?? "",
      Nombre: cols[idxNombre] ?? ""
    };
  }).filter((r) => r.Grupo || r.Documento || r.Nombre);
}

/* ── XLSX parser (SheetJS) ───────────────────────── */
function parseXLSX(data, concatenarCursoGrupo = false) {
  if (typeof XLSX === "undefined") {
    throw new Error("La librería XLSX no está disponible. Recarga la página.");
  }
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // Saltar las 2 primeras filas (título + categorías), igual que CSV
  const useful = allRows.slice(2);
  if (!useful.length) return [];

  const headers = useful[0].map((h) => String(h).trim());
  const idxGrupo = headers.indexOf("Grupo");
  const idxDocumento = headers.indexOf("Documento");
  const idxNombre = headers.indexOf("Nombre");
  const idxCurso = concatenarCursoGrupo ? headers.indexOf("Curso") : -1;

  if ([idxGrupo, idxDocumento, idxNombre].some((idx) => idx < 0)) {
    throw new Error("Archivo inválido: requiere columnas Grupo, Documento y Nombre.");
  }

  return useful.slice(1).map((row) => {
    const curso = idxCurso >= 0 ? String(row[idxCurso] ?? "").trim() : "";
    const grupo = String(row[idxGrupo] ?? "").trim();
    return {
      Grupo: curso ? `${curso} ${grupo}` : grupo,
      Documento: String(row[idxDocumento] ?? "").trim(),
      Nombre: String(row[idxNombre] ?? "").trim()
    };
  }).filter((r) => r.Grupo || r.Documento || r.Nombre);
}

async function detectarCamaras() {
  const select = $("camara");
  select.innerHTML = "";

  // Opciones por facingMode (funciona en iOS/Android sin necesitar permisos previos)
  const optFront = document.createElement("option");
  optFront.value = "user";
  optFront.textContent = "Cámara frontal";
  select.appendChild(optFront);

  const optBack = document.createElement("option");
  optBack.value = "environment";
  optBack.textContent = "Cámara trasera";
  select.appendChild(optBack);

  // Intentar enumerar dispositivos específicos (solo muestra labels si ya hay permiso)
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.currentDevices = devices.filter((d) => d.kind === "videoinput");
    state.currentDevices.forEach((d) => {
      if (d.label && d.deviceId) {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label;
        select.appendChild(opt);
      }
    });
  } catch { /* enumerateDevices no disponible */ }
}

async function activarCamara() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  const selected = $("camara").value;

  let videoConstraints;
  if (selected === "user" || selected === "environment") {
    // Selección por facingMode (mobile-friendly, funciona en iOS)
    videoConstraints = {
      facingMode: { ideal: selected },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };
  } else if (selected) {
    // Selección por deviceId específico (desktop)
    videoConstraints = {
      deviceId: { exact: selected },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };
  } else {
    // Fallback: cámara frontal por defecto
    videoConstraints = {
      facingMode: { ideal: "user" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };
  }

  state.stream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false
  });
  $("preview").srcObject = state.stream;

  // Re-detectar cámaras ahora que el permiso fue otorgado (labels disponibles)
  const prev = selected;
  await detectarCamaras();
  $("camara").value = prev;
}

function seleccionarGrupo() {
  const grp = $("grupo").value;
  state.grupoActual = grp;
  state.driveHDGrupoId = null;
  state.driveCedulaGrupoId = null;
  state.estudiantes = state.rows.filter((r) => String(r.Grupo).trim() === grp.trim());
  state.seleccion = null;
  $("grupo-actual").textContent = grp || "No seleccionado";
  renderEstudiantes();
  actualizarPendientesYStats();
  actualizarStudentPreview();
  $("estudiante-actual").textContent = "Estudiante: Ninguno seleccionado";
  // Sincronizar fotos desde Drive si hay sesión activa
  if (state.driveToken) sincronizarFotosDeDrive(grp).catch(() => {});
}

function renderEstudiantes() {
  const busqueda = $("buscar").value.toLowerCase().trim();
  const ul = $("estudiantes");
  ul.innerHTML = "";
  state.estudiantes.forEach((e, idx) => {
    const doc = sanitizeDoc(e.Documento);
    const nombre = String(e.Nombre).trim();
    if (busqueda && !nombre.toLowerCase().includes(busqueda) && !doc.includes(busqueda)) return;
    const li = document.createElement("li");
    const tieneFoto = state.fotos.has(doc);

    const enDrive = state.driveFiles.has(doc);
    if (tieneFoto) {
      li.classList.add("done", "has-thumb");
      const img = document.createElement("img");
      img.className = "student-thumb";
      img.src = state.fotos.get(doc);
      img.alt = nombre;
      li.appendChild(img);
      const col = document.createElement("div");
      col.className = "student-info-col";
      const driveLabel = state.driveToken ? (enDrive ? " · Drive ✓" : " · Local") : "";
      col.innerHTML = `<span class="student-name-row">${nombre} - ${doc}</span><span class="student-status-row status-done">Con foto${driveLabel}</span>`;
      li.appendChild(col);
    } else {
      li.classList.add("has-thumb");
      const placeholder = document.createElement("div");
      placeholder.className = "student-thumb";
      placeholder.style.cssText = "background:var(--line);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--muted);";
      placeholder.textContent = "—";
      li.appendChild(placeholder);
      const col = document.createElement("div");
      col.className = "student-info-col";
      col.innerHTML = `<span class="student-name-row">${nombre} - ${doc}</span><span class="student-status-row">Sin foto</span>`;
      li.appendChild(col);
    }

    if (state.seleccion && sanitizeDoc(state.seleccion.Documento) === doc) li.classList.add("selected");
    li.onclick = () => {
      state.seleccion = state.estudiantes[idx];
      $("estudiante-actual").textContent = `Estudiante: ${nombre} - ${doc}`;
      renderEstudiantes();
      actualizarStudentPreview();
    };
    ul.appendChild(li);
  });
}

function actualizarStudentPreview() {
  const panel = $("student-preview");
  if (!state.seleccion) {
    panel.hidden = true;
    return;
  }
  const doc = sanitizeDoc(state.seleccion.Documento);
  const nombre = String(state.seleccion.Nombre).trim();
  const tieneFoto = state.fotos.has(doc);
  const foto = $("sp-photo");
  const noFoto = $("sp-no-photo");

  panel.hidden = false;
  $("sp-name").textContent = nombre;
  $("sp-doc").textContent = `Doc: ${doc}`;

  if (tieneFoto) {
    foto.src = state.fotos.get(doc);
    foto.hidden = false;
    noFoto.hidden = true;
  } else {
    foto.hidden = true;
    noFoto.hidden = false;
  }

  // Drive status badge
  const badge = $("sp-drive-status");
  if (state.driveToken) {
    badge.hidden = false;
    if (state.driveFiles.has(doc)) {
      badge.textContent = "Subida a Drive";
      badge.className = "sp-drive-badge drive-synced";
    } else if (tieneFoto) {
      badge.textContent = "Solo local";
      badge.className = "sp-drive-badge drive-local";
    } else {
      badge.textContent = "Sin foto";
      badge.className = "sp-drive-badge drive-pending";
    }
  } else {
    badge.hidden = true;
  }
}

async function capturarFoto() {
  if (!state.seleccion) return toast("Selecciona un estudiante primero.", "error");
  if (!state.stream) {
    try {
      await activarCamara();
      toast("Cámara activada. Posiciona al estudiante y presiona Capturar.", "info");
    } catch (e) {
      toast(`No se pudo activar cámara: ${e.message}`, "error");
    }
    return;
  }
  guardarFoto();
}

function guardarFoto() {
  if (!state.seleccion) return toast("Selecciona un estudiante primero.", "error");
  if (!state.stream) return toast("Activa la cámara primero.", "error");
  const video = $("preview");
  const canvas = $("captura");
  // Capture at full camera resolution
  const vw = video.videoWidth || 320;
  const vh = video.videoHeight || 240;
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, vw, vh);

  // Center crop: tomar el cuadrado más grande del centro del frame
  const cropSize = Math.min(vw, vh);
  const sx = (vw - cropSize) / 2;
  const sy = (vh - cropSize) / 2;

  // SIGED: 100x100 PNG (center-cropped)
  const out = document.createElement("canvas");
  out.width = PHOTO_WIDTH;
  out.height = PHOTO_HEIGHT;
  out.getContext("2d").drawImage(canvas, sx, sy, cropSize, cropSize, 0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  const dataUrl = out.toDataURL("image/png");

  // HD: 1080x1080 JPEG (center-cropped)
  const outHD = document.createElement("canvas");
  outHD.width = HD_WIDTH;
  outHD.height = HD_HEIGHT;
  outHD.getContext("2d").drawImage(canvas, sx, sy, cropSize, cropSize, 0, 0, HD_WIDTH, HD_HEIGHT);
  const dataUrlHD = outHD.toDataURL("image/jpeg", 0.92);

  // Por cédula: 600x600 JPEG de peso reducido (center-cropped)
  const outMid = document.createElement("canvas");
  outMid.width = MID_WIDTH;
  outMid.height = MID_HEIGHT;
  outMid.getContext("2d").drawImage(canvas, sx, sy, cropSize, cropSize, 0, 0, MID_WIDTH, MID_HEIGHT);
  const dataUrlMid = outMid.toDataURL("image/jpeg", MID_QUALITY);

  const doc = sanitizeDoc(state.seleccion.Documento);
  state.fotos.set(doc, dataUrl);
  state.fotosHD.set(doc, dataUrlHD);
  state.fotosCedula.set(doc, dataUrlMid);

  const ultima = $("ultima-foto").getContext("2d");
  const img = new Image();
  img.onload = () => {
    ultima.clearRect(0, 0, 150, 150);
    ultima.drawImage(img, 0, 0, 150, 150);
  };
  img.src = dataUrl;

  $("ultimo-estudiante").textContent = `${state.seleccion.Nombre} (${doc})`;
  renderEstudiantes();
  actualizarPendientesYStats();
  actualizarStudentPreview();
  guardarSesion();

  const nombreEst = state.seleccion.Nombre;

  // Persistir HD en IndexedDB
  guardarSesionHD();

  // Subir a Drive automáticamente si hay sesión activa
  if (state.driveToken) {
    toast(`Foto guardada: ${nombreEst}. Subiendo a Drive…`, "info", 2000);
    (async () => {
      try {
        // Pre-crear todas las carpetas de Drive secuencialmente para evitar race conditions
        if (!state.driveFolderId) {
          state.driveFolderId = await encontrarOCrearCarpeta(DRIVE_ROOT);
        }
        if (!state.driveGrupoId && state.grupoActual) {
          state.driveGrupoId = await encontrarOCrearCarpeta(state.grupoActual, state.driveFolderId);
          actualizarDrivePanel();
        }
        if (!state.driveHDFolderId) {
          state.driveHDFolderId = await encontrarOCrearCarpeta(HD_FOLDER_NAME, state.driveFolderId);
        }
        if (!state.driveHDGrupoId && state.grupoActual) {
          state.driveHDGrupoId = await encontrarOCrearCarpeta(state.grupoActual, state.driveHDFolderId);
        }
        if (!state.driveCedulaFolderId) {
          state.driveCedulaFolderId = await encontrarOCrearCarpeta(CEDULA_FOLDER_NAME, state.driveFolderId);
        }
        if (!state.driveCedulaGrupoId && state.grupoActual) {
          state.driveCedulaGrupoId = await encontrarOCrearCarpeta(state.grupoActual, state.driveCedulaFolderId);
        }
        // Subir las tres fotos en paralelo (las carpetas ya existen)
        await Promise.all([
          subirFotoADrive(doc, dataUrl),
          subirFotoHDADrive(doc, nombreEst, dataUrlHD),
          subirFotoCedulaADrive(doc, dataUrlMid)
        ]);
        actualizarStudentPreview();
        actualizarDrivePanel();
        renderEstudiantes();
        const ruta = state.grupoActual ? `${DRIVE_ROOT} / ${state.grupoActual}` : DRIVE_ROOT;
        toast(`Subida a Drive: ${doc}.png → ${ruta} (+ HD)`, "success", 4000);
      } catch (e) {
        toast(`No se pudo subir a Drive: ${e.message}`, "error", 5000);
      }
    })();
  } else {
    toast(`Foto guardada: ${nombreEst} (SIGED + HD)`, "success");
  }
}

function actualizarPendientesYStats() {
  const pendientes = $("pendientes");
  pendientes.innerHTML = "";
  let conFoto = 0;
  state.estudiantes.forEach((e) => {
    const doc = sanitizeDoc(e.Documento);
    if (state.fotos.has(doc)) {
      conFoto++;
    } else {
      const li = document.createElement("li");
      li.textContent = e.Nombre;
      pendientes.appendChild(li);
    }
  });

  const total = state.estudiantes.length;
  const sin = total - conFoto;
  $("stat-total").textContent = String(total);
  $("stat-con-foto").textContent = String(conFoto);
  $("stat-pendientes").textContent = String(sin);
  $("progress").value = total ? (conFoto / total) * 100 : 0;
}

function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function comprimirGrupo() {
  if (!state.grupoActual) return toast("Selecciona un grupo primero.", "error");
  const zip = new JSZip();
  const folderSiged = zip.folder("SIGED");
  const folderHD = zip.folder(HD_FOLDER_NAME);
  const folderCedula = zip.folder(CEDULA_FOLDER_NAME);
  let countHD = 0;
  let countCedula = 0;
  for (const e of state.estudiantes) {
    const doc = sanitizeDoc(e.Documento);
    if (!state.fotos.has(doc)) continue;
    // SIGED: 100x100 PNG nombrada por documento
    const data = state.fotos.get(doc).split(",")[1];
    folderSiged.file(`${doc}.png`, data, { base64: true });
    // HD: 1080x1080 JPEG nombrada por nombre_apellido_cédula
    if (state.fotosHD.has(doc)) {
      const nombreArchivo = generarNombreHD(e.Nombre, e.Documento);
      const dataHD = state.fotosHD.get(doc).split(",")[1];
      folderHD.file(`${nombreArchivo}.jpg`, dataHD, { base64: true });
      countHD++;
    }
    // Por cédula: 600x600 JPEG de peso reducido nombrada solo con la cédula.
    // Si la foto se capturó antes de esta versión, la derivamos de la HD (o la SIGED).
    if (!state.fotosCedula.has(doc)) {
      const fuente = state.fotosHD.get(doc) ?? state.fotos.get(doc);
      try { state.fotosCedula.set(doc, await generarVersionCedula(fuente)); } catch { /* ignorar */ }
    }
    if (state.fotosCedula.has(doc)) {
      const dataCedula = state.fotosCedula.get(doc).split(",")[1];
      folderCedula.file(`${doc}.jpg`, dataCedula, { base64: true });
      countCedula++;
    }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(`${state.grupoActual}.zip`, blob);
  const extras = [];
  if (countHD > 0) extras.push(`${countHD} HD`);
  if (countCedula > 0) extras.push(`${countCedula} por cédula`);
  const extraMsg = extras.length ? ` (+ ${extras.join(", ")})` : "";
  toast(`ZIP generado: ${state.grupoActual}.zip${extraMsg}`, "success");
}

function generarPdfAsistencia() {
  if (!state.grupoActual) return toast("Selecciona un grupo primero.", "error");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const total = state.estudiantes.length;
  const hoy = new Date().toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });

  const colNum = 10;
  const colCheck = 14;
  const colNombre = pw - margin * 2 - colNum - colCheck;
  const rowH = 7.5;
  const headerH = 8;

  const espacioEncabezado = 28;
  const espacioPie = 14;
  const filasPorPagina = Math.floor((ph - margin - espacioEncabezado - headerH - espacioPie) / rowH);
  const totalPaginas = Math.ceil(total / filasPorPagina);

  for (let p = 0; p < totalPaginas; p++) {
    if (p > 0) pdf.addPage();

    // Encabezado
    let y = margin;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(0, 0, 0);
    pdf.text("LISTA DE ASISTENCIA - REGISTRO FOTOGRAFICO", pw / 2, y, { align: "center" });

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    y += 8;
    pdf.text(`Grupo: ${state.grupoActual}`, margin, y);
    pdf.text(`Fecha: ${hoy}`, pw - margin, y, { align: "right" });
    y += 5;
    pdf.text(`Total: ${total} estudiantes`, margin, y);
    if (totalPaginas > 1) pdf.text(`Pag. ${p + 1}/${totalPaginas}`, pw - margin, y, { align: "right" });
    y += 5;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.4);
    pdf.line(margin, y, pw - margin, y);
    y += 4;

    // Cabecera de tabla
    pdf.setFillColor(230, 230, 230);
    pdf.rect(margin, y, pw - margin * 2, headerH, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    const hcY = y + headerH / 2 + 1.5;
    let x = margin;
    pdf.text("N\u00b0", x + colNum / 2, hcY, { align: "center" });
    x += colNum;
    pdf.line(x, y, x, y + headerH);
    pdf.text("NOMBRE - DOCUMENTO", x + 2, hcY);
    x += colNombre;
    pdf.line(x, y, x, y + headerH);
    pdf.text("VINO", x + colCheck / 2, hcY, { align: "center" });
    y += headerH;

    // Filas
    const inicio = p * filasPorPagina;
    const fin = Math.min(inicio + filasPorPagina, total);
    for (let i = inicio; i < fin; i++) {
      const e = state.estudiantes[i];
      const doc = sanitizeDoc(e.Documento);
      const nombre = String(e.Nombre).trim();
      const esPar = i % 2 === 0;

      if (esPar) {
        pdf.setFillColor(248, 248, 248);
        pdf.rect(margin, y, pw - margin * 2, rowH, "F");
      }
      pdf.setDrawColor(190, 190, 190);
      pdf.setLineWidth(0.1);
      pdf.rect(margin, y, pw - margin * 2, rowH, "S");

      const cY = y + rowH / 2 + 1.5;
      x = margin;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`${i + 1}`, x + colNum / 2, cY, { align: "center" });
      x += colNum;
      pdf.line(x, y, x, y + rowH);

      pdf.setFont("helvetica", "normal");
      const texto = `${nombre}  -  ${doc}`;
      const textoCorto = texto.length > 65 ? texto.substring(0, 63) + "..." : texto;
      pdf.text(textoCorto, x + 2, cY);
      x += colNombre;
      pdf.line(x, y, x, y + rowH);

      // Casilla
      const sz = 3.8;
      pdf.setDrawColor(120, 120, 120);
      pdf.setLineWidth(0.25);
      pdf.rect(x + (colCheck - sz) / 2, y + (rowH - sz) / 2, sz, sz, "S");

      y += rowH;
    }

    // Borde exterior
    const tablaAlto = headerH + (fin - inicio) * rowH;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.4);
    pdf.rect(margin, y - tablaAlto, pw - margin * 2, tablaAlto, "S");
  }

  pdf.save(`asistencia_${state.grupoActual}.pdf`);
  toast("Lista de asistencia generada.", "success");
}

function drawPie(total, conFoto) {
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 240;
  const ctx = c.getContext("2d");
  const sin = total - conFoto;
  const cx = 120, cy = 120, r = 80;
  const angleCon = total ? (Math.PI * 2 * conFoto / total) : 0;

  ctx.fillStyle = "#2ecc71";
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, 0, angleCon); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e74c3c";
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, angleCon, Math.PI * 2); ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#222";
  ctx.font = "14px Arial";
  ctx.fillText(`Con foto: ${conFoto}`, 240, 100);
  ctx.fillText(`Pendientes: ${sin}`, 240, 130);
  return c.toDataURL("image/png");
}

function exportarEstado() {
  if (!state.grupoActual) return toast("Selecciona un grupo primero.", "error");
  const { jsPDF } = window.jspdf;
  const total = state.estudiantes.length;
  const conFoto = state.estudiantes.filter((e) => state.fotos.has(sanitizeDoc(e.Documento))).length;
  const sin = total - conFoto;

  const pdf = new jsPDF();
  pdf.setFontSize(14);
  pdf.text(`Reporte de Estado - Grupo ${state.grupoActual}`, 10, 15);
  pdf.setFontSize(10);
  pdf.text(`Total: ${total}`, 10, 30);
  pdf.text(`Con foto: ${conFoto}`, 10, 38);
  pdf.text(`Pendientes: ${sin}`, 10, 46);
  pdf.addImage(drawPie(total, conFoto), "PNG", 10, 55, 180, 100);

  pdf.addPage();
  pdf.setFontSize(12);
  pdf.text("Estudiantes pendientes", 10, 15);
  let y = 25;
  state.estudiantes.forEach((e, i) => {
    const doc = sanitizeDoc(e.Documento);
    if (state.fotos.has(doc)) return;
    if (y > 280) { pdf.addPage(); y = 20; }
    pdf.text(`${i + 1}. ${e.Nombre} - ${doc}`, 10, y);
    y += 8;
  });
  pdf.save(`estado_${state.grupoActual}.pdf`);
  toast("Reporte de estado exportado.", "success");
}

function exportarTodos() {
  if (!state.rows.length) return toast("Carga el CSV primero.", "error");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const groups = [...new Set(state.rows.map((r) => String(r.Grupo).trim()))].sort();
  let total = 0;
  groups.forEach((g, gi) => {
    if (gi) pdf.addPage();
    pdf.setFontSize(14);
    pdf.text(`Grupo ${g}`, 10, 15);
    let y = 25;
    const ests = state.rows.filter((r) => String(r.Grupo).trim() === g.trim());
    ests.forEach((e, i) => {
      if (y > 280) { pdf.addPage(); y = 20; }
      const doc = sanitizeDoc(e.Documento);
      pdf.setFontSize(10);
      pdf.text(`${i + 1}. ${e.Nombre} - ${doc} [ ]`, 10, y);
      y += 8;
    });
    total += ests.length;
  });
  pdf.addPage();
  pdf.setFontSize(14);
  pdf.text("Resumen general", 10, 15);
  let y = 25;
  groups.forEach((g) => {
    const count = state.rows.filter((r) => String(r.Grupo).trim() === g.trim()).length;
    pdf.setFontSize(10);
    pdf.text(`${g}: ${count}`, 10, y);
    y += 8;
  });
  pdf.text(`TOTAL: ${total}`, 10, y + 10);
  pdf.save("todos_los_estudiantes.pdf");
  toast("Reporte completo exportado.", "success");
}

function initHelp() {
  const dlg = $("help-modal");
  document.querySelectorAll(".help-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const entry = helpText[b.dataset.help];
      $("help-title").textContent = entry?.title ?? "Ayuda";
      $("help-body").textContent  = entry?.body  ?? "Sin descripción.";
      dlg.showModal();
    });
  });
}

function bindEvents() {
  $("btn-activar").onclick = () => activarCamara().catch((e) => toast(`No se pudo activar cámara: ${e.message}`, "error"));

  $("csv-file").onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const isXlsx = /\.xlsx?$/i.test(file.name);
    const esSecundaria = $("nivel").value === "secundaria";
    try {
      if (isXlsx) {
        const buffer = await file.arrayBuffer();
        state.rows = parseXLSX(buffer, esSecundaria);
      } else {
        const text = await file.text();
        state.rows = parseCSV(text, esSecundaria);
      }
    } catch (err) {
      return toast(err.message, "error", 5000);
    }
    state.groups = [...new Set(state.rows.map((r) => String(r.Grupo).trim()))].filter(Boolean).sort();
    $("grupo").innerHTML = state.groups.map((g) => `<option value="${g}">${g}</option>`).join("");
    if (state.groups.length) {
      $("grupo").value = state.groups[0];
      seleccionarGrupo();
      toast(`Datos cargados: ${state.rows.length} estudiantes en ${state.groups.length} grupos.`, "info");
    }
  };

  $("btn-cargar-url").onclick = () => {
    const url = $("csv-url").value.trim();
    if (!url) return toast("Pega una URL válida primero.", "error");
    cargarDesdeUrl(url);
  };

  $("btn-olvidar-url").onclick = () => {
    const key = obtenerUrlKeyNivel();
    localStorage.removeItem(key);
    $("csv-url").value = "";
    actualizarStatusUrl(null);
    const nivel = $("nivel").value === "secundaria" ? "Secundaria" : "Primaria";
    toast(`URL de ${nivel} eliminada del navegador.`, "info");
  };

  $("nivel").onchange = () => {
    const nivel = $("nivel").value;
    localStorage.setItem(STORAGE_NIVEL_KEY, nivel);
    const key = obtenerUrlKeyNivel();
    const savedUrl = localStorage.getItem(key);
    $("csv-url").value = savedUrl || "";
    actualizarStatusUrl(savedUrl);
    if (savedUrl) {
      cargarDesdeUrl(savedUrl, true);
    } else {
      state.rows = [];
      state.groups = [];
      state.grupoActual = "";
      state.estudiantes = [];
      state.seleccion = null;
      $("grupo").innerHTML = "";
      $("grupo-actual").textContent = "No seleccionado";
      $("estudiantes").innerHTML = "";
      actualizarPendientesYStats();
      actualizarStudentPreview();
      $("estudiante-actual").textContent = "Estudiante: Ninguno seleccionado";
    }
  };

  $("btn-limpiar-sesion").onclick = limpiarSesion;

  $("btn-login-google").onclick  = loginConGoogle;
  $("btn-logout-google").onclick = logoutGoogle;
  $("btn-config-drive").onclick  = () => {
    const id = obtenerClientId();
    if (id) $("client-id-input").value = id;
    $("config-drive-modal").showModal();
  };
  $("btn-guardar-config-drive").onclick = () => {
    const id = $("client-id-input").value.trim();
    if (!id) return toast("Pega el Client ID primero.", "error");
    localStorage.setItem(STORAGE_GCLIENT_KEY, id);
    $("config-drive-modal").close();
    tokenClient = null; // forzar reinicialización con nuevo ID
    loginConGoogle();
  };

  $("btn-seleccionar").onclick = seleccionarGrupo;
  $("buscar").oninput = renderEstudiantes;
  $("btn-guardar").onclick = guardarFoto;
  $("btn-finalizar").onclick = comprimirGrupo;
  $("btn-asistencia").onclick = generarPdfAsistencia;
  $("btn-estado").onclick = exportarEstado;
  $("btn-todos").onclick = exportarTodos;

  // Capturar button (auto-activates camera if needed, then captures)
  $("btn-capturar").onclick = capturarFoto;

  // Inline ZIP button under camera
  $("btn-zip-inline").onclick = comprimirGrupo;

  // Mobile bottom toolbar buttons
  $("tb-activar").onclick = () => activarCamara().catch((e) => toast(`No se pudo activar cámara: ${e.message}`, "error"));
  $("tb-capturar").onclick = capturarFoto;
  $("tb-guardar").onclick = guardarFoto;
  $("tb-zip").onclick = comprimirGrupo;
}

(async function init() {
  bindEvents();
  initHelp();

  // Restaurar fotos guardadas en el navegador
  restaurarSesion();
  await restaurarSesionHD();
  actualizarInfoSesion();

  // Migrar URL legacy a per-level (una sola vez)
  const legacyUrl = localStorage.getItem(STORAGE_URL_KEY);
  if (legacyUrl) {
    if (!localStorage.getItem(STORAGE_URL_PRIMARIA)) {
      localStorage.setItem(STORAGE_URL_PRIMARIA, legacyUrl);
    }
    localStorage.removeItem(STORAGE_URL_KEY);
  }

  // Restaurar nivel guardado
  const savedNivel = localStorage.getItem(STORAGE_NIVEL_KEY);
  if (savedNivel) $("nivel").value = savedNivel;

  // Restaurar URL del nivel actual y auto-cargar datos
  const urlKey = obtenerUrlKeyNivel();
  const savedUrl = localStorage.getItem(urlKey);
  if (savedUrl) {
    $("csv-url").value = savedUrl;
    actualizarStatusUrl(savedUrl);
    await cargarDesdeUrl(savedUrl, true);
  }

  // Pre-inicializar GIS (el script se carga de forma sincrónica antes que este módulo)
  const clientId = obtenerClientId();
  if (clientId && window.google?.accounts?.oauth2) {
    inicializarGIS(clientId);
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Este navegador no soporta acceso a cámara.", "error", 5000);
    return;
  }
  await detectarCamaras().catch(() => {});
})();
