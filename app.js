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
const SIGED_FOLDER_NAME = "SIGED";

// Niveles educativos. La carpeta de cada nivel se crea dentro de la carpeta
// del año lectivo: <raíz>/<año>/<nivel>/{SIGED, HD, por cédula}/<grupo>
const NIVELES = {
  inicial:    { label: "Inicial",    carpeta: "Inicial",    concatenarCurso: false },
  primaria:   { label: "Primaria",   carpeta: "Primaria",   concatenarCurso: false },
  secundaria: { label: "Secundaria", carpeta: "Secundaria", concatenarCurso: true }
};

// Cuentas que pueden editar la configuración central (carpetas y bases de datos).
const ADMIN_EMAILS = ["martinferreira@hca.edu.uy"];
// Archivo JSON con la configuración central. Vive en la carpeta raíz de Drive
// del administrador; al compartir esa carpeta, todos los usuarios lo leen.
const CONFIG_FILE_NAME = "siged-config.json";

/* ── Toast notifications ──────────────────────────── */
function toast(message, type = "info", duration = 3200) {
  const container = document.getElementById("toast-container");
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span>${icons[type] ?? icons.info}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast--out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, duration);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const state = {
  rows: [],
  groups: [],
  grupoActual: "",
  estudiantes: [],
  seleccion: null,
  fotos: new Map(),       // documento => dataURL (100x100)
  fotosHD: new Map(),     // documento => dataURL (1080x1080)
  fotosCedula: new Map(), // documento => dataURL (600x600, peso reducido)
  fotosMeta: new Map(),   // documento => { fecha, anio, nivel, grupo, origen }
  stream: null,
  currentDevices: [],
  // Google Drive
  driveToken:    null,
  driveTokenExpira: null, // timestamp de vencimiento del token
  driveUser:     null,
  esAdmin:       false,
  // Configuración central
  config:        null,
  configFileId:  null,
  configOrigen:  "defecto", // "drive" | "cache" | "defecto"
  // Carpetas de Drive resueltas: ruta ("/2026/Primaria/SIGED/3A") => folderId
  carpetas: new Map(),
  grupoCarpetas: null,     // { clave, siged, hd, cedula }
  grupoCarpetasPromesa: null,
  // Archivos en Drive del grupo actual: documento => [fileId, ...] (más reciente primero)
  driveFiles:       new Map(),
  driveHDFiles:     new Map(),
  driveCedulaFiles: new Map(),
  driveFechas:      new Map(), // documento => modifiedTime (ms) de la foto SIGED en Drive
  fuenteActual: null,          // descripción de la base de datos cargada
  registro: null,              // último registro de actividad cargado (admin)
  inventario: null,            // carpetas de grupo y fotos del año (Gestión)
  migracionPlan: null,         // grupos detectados en una carpeta antigua
  vista: "fotos"
};

const helpText = {
  "panel-info":        { title: "Información general",     body: "Muestra resumen del grupo: cuántos estudiantes hay, cuántos tienen foto y el progreso general." },
  "ultima-foto":       { title: "Última foto tomada",      body: "Presenta una miniatura de la foto más reciente y el nombre/documento del estudiante asociado." },
  "nivel":             { title: "Nivel educativo",         body: "Selecciona Inicial, Primaria o Secundaria. El administrador define de qué carpeta de Drive se toma la base de datos de cada nivel; al cambiar de nivel se carga automáticamente. Las fotos se guardan en Drive dentro de <año lectivo>/<nivel>/<grupo>." },
  "activar-camara":    { title: "Activar cámara",          body: "Solicita permisos de cámara al navegador y habilita la vista previa en tiempo real." },
  "base-datos":        { title: "Base de datos",           body: "Con Drive conectado, la lista de estudiantes se carga sola desde la carpeta que configuró el administrador para el nivel (se usa el XLSX/CSV más reciente). Usa \"Recargar\" si el administrador subió un archivo nuevo. La carga manual es solo un respaldo." },
  "cargar-csv":        { title: "Cargar archivo de datos", body: "Lee un archivo CSV o XLSX local (sin subirlo a internet), detecta grupos y prepara la lista de estudiantes. Soporta el formato de exportación SIGED." },
  "seleccionar-grupo": { title: "Seleccionar grupo",       body: "Filtra estudiantes por grupo y sincroniza con Drive las fotos que ya existan de ese grupo (tomadas por cualquier usuario)." },
  "guardar-foto":      { title: "Guardar foto",            body: "Captura el frame actual de la cámara y genera tres versiones: 100×100 px para SIGED, 1080×1080 px en alta resolución (nombre_apellido_cédula) y 600×600 px de peso reducido nombrada solo con la cédula. Si el estudiante ya tenía foto en Drive, la nueva la reemplaza y la vieja se elimina." },
  "subir-foto":        { title: "Subir foto desde archivo", body: "Permite elegir una imagen del dispositivo (galería, archivo) en lugar de usar la cámara. Se recorta al centro en formato cuadrado y se generan las mismas tres versiones que al capturar. Reemplaza la foto anterior del estudiante." },
  "comprimir":         { title: "Generar ZIP del grupo",   body: "Genera un ZIP con tres carpetas: SIGED (100×100), imágenes de estudiantes alta resolución (1080×1080) e imágenes por cédula (600×600). Si faltan versiones en este dispositivo se descargan desde Drive." },
  "cargar-url":        { title: "URL fija de datos",       body: "Respaldo manual: pega el link de un Google Sheets, un archivo XLSX en Google Drive o un CSV en GitHub Raw. Se guarda por nivel solo en este navegador. Si el administrador configuró una base central, esta tiene prioridad." },
  "gestion-zip":       { title: "Descargar fotos en ZIP", body: "Arma un ZIP con las fotos que están en Drive para el año lectivo actual. Elige el nivel, marca los grupos a incluir y qué versiones quieres (alta resolución, peso reducido o SIGED). Dentro del ZIP cada archivo se llama solo con la cédula del estudiante." },
  "gestion-migrar":    { title: "Migrar carpetas anteriores", body: "Compatibilidad con versiones anteriores: pega el link de la carpeta vieja (la \"SIGED Fotos\" antigua con sus subcarpetas de grupo, alta resolución y por cédula, o directamente una carpeta de grupo). La app detecta los grupos y copia las fotos, conservando alta y baja resolución, a la carpeta del año y nivel que elijas. La carpeta original no se modifica." },
  "admin":             { title: "Administración",          body: "Solo para cuentas administradoras. Define el año lectivo, la carpeta raíz de Drive donde trabajan todos los usuarios y la carpeta o archivo de base de datos de cada nivel. También muestra quién fue el último en modificar las fotos de cada grupo." }
};

const $ = (id) => document.getElementById(id);
const STORAGE_URL_KEY    = "siged_csv_url"; // legacy — migrated to per-level keys
const STORAGE_FOTOS_KEY  = "siged_fotos";
const STORAGE_GCLIENT_KEY = "siged_google_client_id";
const STORAGE_NIVEL_KEY   = "siged_nivel";
const STORAGE_URL_PRIMARIA   = "siged_url_primaria";
const STORAGE_URL_SECUNDARIA = "siged_url_secundaria";
const STORAGE_URL_PREFIX     = "siged_url_";
const STORAGE_GRUPO_PREFIX   = "siged_grupo_";
const STORAGE_CONFIG_CACHE   = "siged_config_cache";
const DRIVE_ROOT          = "SIGED Fotos";
const DEFAULT_CLIENT_ID   = "263672487463-bf0e1fn8k66tnvsfld7dtnmmd5ag6t46.apps.googleusercontent.com";
// Se necesita el permiso completo de Drive para trabajar sobre carpetas
// compartidas por el administrador (con drive.file cada usuario solo veía
// los archivos creados por él mismo).
const DRIVE_SCOPE  = "https://www.googleapis.com/auth/drive";
const DRIVE_SCOPES = `${DRIVE_SCOPE} profile email`;
const FOLDER_MIME  = "application/vnd.google-apps.folder";
const GSHEET_MIME  = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME    = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let tokenClient = null;
let pendingToken = null;      // solicitud de token en curso { resolve, reject }
let renovacionEnCurso = null; // promesa compartida para no pedir dos tokens a la vez

function sanitizeDoc(value) {
  return String(value ?? "").replace(/[.-]/g, "").trim();
}

function nivelActual() {
  const v = $("nivel")?.value;
  return v in NIVELES ? v : "primaria";
}

function claveUrlNivel(nivel = nivelActual()) {
  if (nivel === "primaria") return STORAGE_URL_PRIMARIA;
  if (nivel === "secundaria") return STORAGE_URL_SECUNDARIA;
  return `${STORAGE_URL_PREFIX}${nivel}`;
}

function formatoFecha(valor) {
  if (!valor) return "—";
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function nombreUsuario(u) {
  if (!u) return "—";
  return u.displayName || u.emailAddress || u.name || u.email || "—";
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

// Extrae el ID de Drive de un link de carpeta, archivo o Google Sheets.
// También acepta el ID pelado. Devuelve null si no parece de Drive.
function extraerIdDrive(texto) {
  const t = String(texto ?? "").trim();
  if (!t) return null;
  const m = t.match(/\/folders\/([a-zA-Z0-9_-]{10,})/)
    || t.match(/\/(?:file|spreadsheets|document)\/d\/([a-zA-Z0-9_-]{10,})/)
    || t.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(t)) return t;
  return null;
}

function linkCarpetaDrive(id) {
  return `https://drive.google.com/drive/folders/${id}`;
}

function actualizarStatusUrl(url) {
  const el = $("url-status");
  const btn = $("btn-olvidar-url");
  if (url) {
    el.textContent = `✓ URL manual guardada: ${url.length > 60 ? url.slice(0, 57) + "…" : url}`;
    el.className = "field-status field-status--ok";
    btn.hidden = false;
  } else {
    el.textContent = "";
    el.className = "field-status";
    btn.hidden = true;
  }
}

function actualizarStatusFuente() {
  const el = $("fuente-status");
  if (!el) return;
  const f = state.fuenteActual;
  if (!f) {
    const cfg = configActual();
    const central = cfg.niveles?.[nivelActual()]?.fuente;
    if (central && !state.driveToken) {
      el.textContent = "Base central configurada. Conecta Drive para cargarla.";
      el.className = "field-status";
    } else if (!central) {
      el.textContent = state.driveToken
        ? `Sin base central para ${NIVELES[nivelActual()].label}. Pide al administrador que la configure o usa la carga manual.`
        : "Conecta Drive para cargar la base de datos del nivel.";
      el.className = "field-status";
    } else {
      el.textContent = "";
      el.className = "field-status";
    }
    return;
  }
  const partes = [f.descripcion];
  if (f.modificado) partes.push(`actualizado ${formatoFecha(f.modificado)}`);
  if (f.modificadoPor) partes.push(`por ${f.modificadoPor}`);
  el.textContent = `✓ ${partes.join(" · ")}`;
  el.className = f.central ? "field-status field-status--ok" : "field-status field-status--warn";
}

/* ── Configuración central ────────────────────────── */
function configPorDefecto() {
  return {
    version: 1,
    anioLectivo: String(new Date().getFullYear()),
    rootFolderId: "",
    rootFolderName: DRIVE_ROOT,
    niveles: {
      inicial:    { fuente: "" },
      primaria:   { fuente: "" },
      secundaria: { fuente: "" }
    },
    actualizadoPor: "",
    actualizadoEn: ""
  };
}

function normalizarConfig(cfg) {
  const base = configPorDefecto();
  const out = { ...base, ...(cfg ?? {}) };
  out.anioLectivo = String(out.anioLectivo || base.anioLectivo).trim();
  out.rootFolderName = out.rootFolderName || DRIVE_ROOT;
  out.niveles = { ...base.niveles };
  Object.keys(NIVELES).forEach((n) => {
    out.niveles[n] = { fuente: String(cfg?.niveles?.[n]?.fuente ?? "").trim() };
  });
  return out;
}

function configActual() {
  return state.config ?? configPorDefecto();
}

function guardarConfigEnCache() {
  try { localStorage.setItem(STORAGE_CONFIG_CACHE, JSON.stringify(state.config)); } catch { /* ignorar */ }
}

// Busca el archivo de configuración compartido por el administrador.
async function cargarConfiguracionCentral() {
  const { files = [] } = await driveRequest("GET", "files", null, {
    q: `name='${CONFIG_FILE_NAME}' and trashed=false`,
    fields: "files(id,name,modifiedTime,parents,owners(emailAddress),lastModifyingUser(displayName,emailAddress))",
    orderBy: "modifiedTime desc",
    pageSize: "10",
    corpora: "allDrives"
  });
  const esDeAdmin = (f) => (f.owners ?? []).some((o) => ADMIN_EMAILS.includes(String(o.emailAddress ?? "").toLowerCase()));
  const elegido = files.find(esDeAdmin) ?? files[0];
  if (!elegido) {
    state.configFileId = null;
    state.configOrigen = state.config ? "cache" : "defecto";
    return null;
  }
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${elegido.id}?alt=media&supportsAllDrives=true`);
  const cfg = await res.json();
  state.config = normalizarConfig(cfg);
  state.configFileId = elegido.id;
  state.configOrigen = "drive";
  state.carpetas.clear();
  state.grupoCarpetas = null;
  guardarConfigEnCache();
  console.info("[SIGED] Configuración central cargada", { archivo: elegido.id, ...state.config });
  return state.config;
}

// Guarda (crea o actualiza) el archivo de configuración dentro de la carpeta raíz.
async function guardarConfiguracionCentral(cfg) {
  cfg = normalizarConfig(cfg);
  cfg.actualizadoPor = state.driveUser?.email ?? "";
  cfg.actualizadoEn = new Date().toISOString();

  // Resolver/crear la carpeta raíz
  if (cfg.rootFolderId) {
    const meta = await driveRequest("GET", `files/${cfg.rootFolderId}`, null, { fields: "id,name,mimeType" });
    if (meta.mimeType !== FOLDER_MIME) throw new Error("El link de la carpeta raíz no corresponde a una carpeta de Drive.");
    cfg.rootFolderName = meta.name;
  } else {
    cfg.rootFolderId = await encontrarOCrearCarpeta(DRIVE_ROOT);
    cfg.rootFolderName = DRIVE_ROOT;
  }

  // Validar las fuentes de datos que apunten a Drive
  for (const [nivel, info] of Object.entries(cfg.niveles)) {
    const id = extraerIdDrive(info.fuente);
    if (!id) continue;
    try {
      await driveRequest("GET", `files/${id}`, null, { fields: "id,name,mimeType" });
    } catch (e) {
      throw new Error(`No se puede acceder a la fuente de ${NIVELES[nivel].label}: ${e.message}`);
    }
  }

  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
  const form = new FormData();
  let url;
  let method;
  if (state.configFileId) {
    // Mover el archivo si cambió la carpeta raíz
    const actual = await driveRequest("GET", `files/${state.configFileId}`, null, { fields: "id,parents" }).catch(() => null);
    if (!actual) {
      state.configFileId = null;
    } else {
      const padres = actual.parents ?? [];
      const params = new URLSearchParams({ uploadType: "multipart", supportsAllDrives: "true", fields: "id" });
      if (!padres.includes(cfg.rootFolderId)) {
        params.set("addParents", cfg.rootFolderId);
        if (padres.length) params.set("removeParents", padres.join(","));
      }
      url = `https://www.googleapis.com/upload/drive/v3/files/${state.configFileId}?${params}`;
      method = "PATCH";
      form.append("metadata", new Blob([JSON.stringify({ name: CONFIG_FILE_NAME, mimeType: "application/json" })], { type: "application/json" }));
    }
  }
  if (!state.configFileId) {
    url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id";
    method = "POST";
    form.append("metadata", new Blob([JSON.stringify({
      name: CONFIG_FILE_NAME, mimeType: "application/json", parents: [cfg.rootFolderId]
    })], { type: "application/json" }));
  }
  form.append("file", blob);
  const res = await driveFetch(url, { method, body: form });
  const file = await res.json();
  state.configFileId = file.id ?? state.configFileId;
  state.config = cfg;
  state.configOrigen = "drive";
  state.carpetas.clear();
  state.grupoCarpetas = null;
  guardarConfigEnCache();

  // Pre-crear la estructura del año para que quede visible en Drive
  for (const n of Object.values(NIVELES)) {
    await resolverCarpeta([cfg.anioLectivo, n.carpeta, SIGED_FOLDER_NAME]);
    await resolverCarpeta([cfg.anioLectivo, n.carpeta, HD_FOLDER_NAME]);
    await resolverCarpeta([cfg.anioLectivo, n.carpeta, CEDULA_FOLDER_NAME]);
  }
  console.info("[SIGED] Configuración central guardada", cfg);
  return cfg;
}

/* ── Persistencia de sesión (fotos en IndexedDB) ──── */
// Las miniaturas SIGED vivían en localStorage, cuyo límite (~5 MB) se
// llenaba con grupos grandes ("Almacenamiento lleno"). Ahora van a
// IndexedDB como las HD; localStorage queda solo como fallback y como
// origen de migración de sesiones viejas.
async function guardarSesion() {
  try {
    const db = await abrirDB();
    const tx = db.transaction(["fotos_siged", "fotos_meta"], "readwrite");
    const store = tx.objectStore("fotos_siged");
    state.fotos.forEach((v, k) => store.put(v, k));
    const meta = tx.objectStore("fotos_meta");
    state.fotosMeta.forEach((v, k) => meta.put(v, k));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch {
    // IndexedDB no disponible (modo privado muy restrictivo, etc.)
    try {
      const obj = {};
      state.fotos.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(STORAGE_FOTOS_KEY, JSON.stringify(obj));
    } catch {
      toast("El almacenamiento del navegador está lleno. Genera el ZIP para no perder las fotos y luego usa \"Limpiar sesión\".", "error", 7000);
    }
  }
  actualizarInfoSesion();
}

async function restaurarSesion() {
  // Fotos de versiones anteriores guardadas en localStorage
  let legacy = {};
  try {
    legacy = JSON.parse(localStorage.getItem(STORAGE_FOTOS_KEY) ?? "{}");
  } catch { /* datos corruptos — ignorar */ }
  Object.entries(legacy).forEach(([k, v]) => state.fotos.set(k, v));

  try {
    const db = await abrirDB();
    const tx = db.transaction(["fotos_siged", "fotos_meta"], "readonly");
    const reqAll = tx.objectStore("fotos_siged").getAll();
    const reqKeys = tx.objectStore("fotos_siged").getAllKeys();
    const reqMetaAll = tx.objectStore("fotos_meta").getAll();
    const reqMetaKeys = tx.objectStore("fotos_meta").getAllKeys();
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
    for (let i = 0; i < reqKeys.result.length; i++) {
      if (!state.fotos.has(reqKeys.result[i])) state.fotos.set(reqKeys.result[i], reqAll.result[i]);
    }
    for (let i = 0; i < reqMetaKeys.result.length; i++) {
      state.fotosMeta.set(reqMetaKeys.result[i], reqMetaAll.result[i]);
    }
    // Migrar lo legacy a IndexedDB y liberar localStorage, que era lo que
    // provocaba el error de almacenamiento lleno.
    if (Object.keys(legacy).length) {
      await guardarSesion();
      localStorage.removeItem(STORAGE_FOTOS_KEY);
    }
  } catch { /* IndexedDB no disponible — seguir con lo cargado de localStorage */ }
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
  if (!confirm(`¿Borrar las ${state.fotos.size} fotos guardadas en este navegador? Las fotos que ya estén en Drive no se borran de Drive.`)) return;
  state.fotos.clear();
  state.fotosHD.clear();
  state.fotosCedula.clear();
  state.fotosMeta.clear();
  localStorage.removeItem(STORAGE_FOTOS_KEY);
  limpiarSesionHD();
  actualizarInfoSesion();
  renderEstudiantes();
  actualizarPendientesYStats();
  $("ultima-foto").getContext("2d").clearRect(0, 0, 150, 150);
  $("ultimo-estudiante").textContent = "Ninguna foto tomada.";
  actualizarStudentPreview();
  toast("Sesión limpiada. Todas las fotos borradas del navegador.", "info");
  if (state.driveToken && state.grupoActual) sincronizarFotosDeDrive(state.grupoActual).catch(() => {});
}

/* ── IndexedDB para fotos HD y por cédula ────────── */
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("siged_fotos_hd", 4);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("fotos_hd")) db.createObjectStore("fotos_hd");
      if (!db.objectStoreNames.contains("fotos_cedula")) db.createObjectStore("fotos_cedula");
      if (!db.objectStoreNames.contains("fotos_siged")) db.createObjectStore("fotos_siged");
      if (!db.objectStoreNames.contains("fotos_meta")) db.createObjectStore("fotos_meta");
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

// Elimina del dispositivo las versiones HD/cédula de un estudiante (por
// ejemplo cuando otro usuario subió una foto más nueva a Drive).
async function borrarVersionesLocales(doc) {
  state.fotosHD.delete(doc);
  state.fotosCedula.delete(doc);
  try {
    const db = await abrirDB();
    const tx = db.transaction(["fotos_hd", "fotos_cedula"], "readwrite");
    tx.objectStore("fotos_hd").delete(doc);
    tx.objectStore("fotos_cedula").delete(doc);
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch { /* ignorar */ }
}

async function limpiarSesionHD() {
  try {
    const db = await abrirDB();
    const tx = db.transaction(["fotos_hd", "fotos_cedula", "fotos_siged", "fotos_meta"], "readwrite");
    tx.objectStore("fotos_hd").clear();
    tx.objectStore("fotos_cedula").clear();
    tx.objectStore("fotos_siged").clear();
    tx.objectStore("fotos_meta").clear();
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
      cargarTodoDesdeDrive().catch(() => {});
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
  state.esAdmin = ADMIN_EMAILS.includes(String(state.driveUser?.email ?? "").toLowerCase());
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
    // Probar el acceso real a Drive antes de dar la conexión por buena;
    // si faltan permisos, driveFetch revoca el token y los vuelve a pedir.
    await verificarAccesoDrive();
    await obtenerInfoUsuario().catch(() => {});
    actualizarUIUsuario();
    toast("Google Drive conectado correctamente.", "success");
    await cargarTodoDesdeDrive();
  } catch (e) {
    toast(e.message, "error", 8000);
  }
}

// Al conectar: leer la configuración del administrador, cargar la base de
// datos del nivel y sincronizar las fotos existentes del grupo.
async function cargarTodoDesdeDrive() {
  const statusEl = $("drive-status");
  if (statusEl) statusEl.textContent = "Leyendo configuración…";
  try {
    await cargarConfiguracionCentral();
  } catch (e) {
    toast(`No se pudo leer la configuración central: ${e.message}`, "error", 6000);
  }
  if (state.configOrigen !== "drive") {
    if (state.esAdmin) {
      toast("No hay configuración central todavía. Defínela en la sección Gestión (carpetas y bases de datos).", "info", 7000);
    } else {
      toast("No se encontró la configuración central del administrador. Se usará tu Drive personal.", "info", 7000);
    }
  }
  state.carpetas.clear();
  state.grupoCarpetas = null;
  state.inventario = null;
  state.registro = null;
  actualizarUIUsuario();
  const cargada = await cargarBaseNivel({ silencioso: true });
  if (!cargada && state.grupoActual) {
    await sincronizarFotosDeDrive(state.grupoActual).catch(() => {});
  }
  actualizarStatusFuente();
}

function logoutGoogle() {
  if (state.driveToken) google.accounts.oauth2.revoke(state.driveToken, () => {});
  state.driveToken    = null;
  state.driveTokenExpira = null;
  state.driveUser     = null;
  state.esAdmin       = false;
  state.configFileId  = null;
  if (state.configOrigen === "drive") state.configOrigen = "cache";
  state.carpetas.clear();
  state.grupoCarpetas = null;
  state.driveFiles.clear();
  state.driveHDFiles.clear();
  state.driveCedulaFiles.clear();
  state.driveFechas.clear();
  state.inventario = null;
  state.registro = null;
  actualizarUIUsuario();
  actualizarStatusFuente();
  renderEstudiantes();
  toast("Sesión de Google cerrada.", "info");
}

function actualizarUIUsuario() {
  const loggedIn = !!state.driveToken;
  $("btn-login-google").hidden = loggedIn;
  $("user-info").hidden = !loggedIn;
  $("btn-admin").hidden = !(loggedIn && state.esAdmin);
  if (loggedIn && state.driveUser) {
    $("user-name").textContent = state.driveUser.name ?? state.driveUser.email ?? "Usuario";
    const avatar = $("user-avatar");
    if (state.driveUser.picture) { avatar.src = state.driveUser.picture; avatar.hidden = false; }
    else { avatar.hidden = true; }
  }
  actualizarDrivePanel();
  if (state.vista === "gestion") prepararGestion();
}

// ── Drive API helpers ──────────────────────────────
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Todas las llamadas a Drive pasan por acá: agrega el token vigente,
// renueva ante 401, re-pide permisos ante scopes insuficientes y reintenta
// con backoff exponencial ante errores de red, límite de peticiones o 5xx.
async function driveFetch(url, init = {}, reintentos = 3, repararScopes = true) {
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
    if (res.status === 403 && repararScopes && /insufficient|scope/i.test(mensaje)) {
      // El token existe pero sin permiso de Drive (consentimiento incompleto).
      // Revocarlo es clave: si no, Google puede devolver el mismo token
      // defectuoso desde caché en el siguiente intento.
      const tokenMalo = state.driveToken;
      state.driveToken = null;
      state.driveTokenExpira = 0;
      if (tokenMalo) {
        try { google.accounts.oauth2.revoke(tokenMalo, () => {}); } catch { /* ignorar */ }
      }
      try {
        await solicitarToken("consent");
        continue;
      } catch {
        throw new Error('Faltan permisos de Google Drive. Pulsa "Conectar Drive" y, en la pantalla de Google, deja marcada la casilla de acceso a Google Drive.');
      }
    }
    if ((res.status === 403 && !/permission|forbidden|not have/i.test(mensaje)) || res.status === 429 || res.status >= 500) {
      ultimoError = new Error(mensaje);
      continue;
    }
    const err = new Error(mensaje);
    err.status = res.status;
    throw err;
  }
  throw ultimoError ?? new Error("No se pudo conectar con Google Drive.");
}

// Llamada de prueba a la API de Drive. Si el token quedó sin el permiso de
// Drive, driveFetch lo detecta acá mismo (revoca + re-pide consentimiento),
// en vez de fallar recién al subir la primera foto.
async function verificarAccesoDrive() {
  await driveRequest("GET", "files", null, { pageSize: "1", fields: "files(id)", q: "trashed=false" });
}

async function driveRequest(method, path, body = null, params = {}) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  // Soportar carpetas dentro de unidades compartidas
  url.searchParams.set("supportsAllDrives", "true");
  if (method === "GET" && path === "files") url.searchParams.set("includeItemsFromAllDrives", "true");
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

function escaparQ(texto) {
  return String(texto).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Lista todas las páginas de una consulta de archivos.
async function listarArchivos(q, fields = "files(id,name)", { orderBy = "", max = 2000, pageSize = 200 } = {}) {
  const out = [];
  let pageToken = "";
  do {
    const params = { q, fields: `nextPageToken,${fields}`, pageSize: String(pageSize) };
    if (orderBy) params.orderBy = orderBy;
    if (pageToken) params.pageToken = pageToken;
    const data = await driveRequest("GET", "files", null, params);
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken && out.length < max);
  return out;
}

async function buscarCarpeta(nombre, parentId = null) {
  let q = `name='${escaparQ(nombre)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const { files = [] } = await driveRequest("GET", "files", null, { q, fields: "files(id)", orderBy: "createdTime", pageSize: "5" });
  return files[0]?.id ?? null;
}

async function encontrarOCrearCarpeta(nombre, parentId = null) {
  const existente = await buscarCarpeta(nombre, parentId);
  if (existente) return existente;
  const carpeta = await driveRequest("POST", "files", {
    name: nombre,
    mimeType: FOLDER_MIME,
    ...(parentId ? { parents: [parentId] } : {})
  }, { fields: "id" });
  return carpeta.id;
}

// Carpeta raíz de trabajo: la configurada por el administrador o, si no hay
// configuración, "SIGED Fotos" en el Drive del usuario.
async function obtenerCarpetaRaiz() {
  if (state.carpetas.has("")) return state.carpetas.get("");
  const cfg = configActual();
  let id = cfg.rootFolderId;
  if (id) {
    try {
      await driveRequest("GET", `files/${id}`, null, { fields: "id" });
    } catch (e) {
      throw new Error(`No tienes acceso a la carpeta raíz "${cfg.rootFolderName}". Pide al administrador que la comparta contigo (${e.message}).`);
    }
  } else {
    id = await encontrarOCrearCarpeta(cfg.rootFolderName || DRIVE_ROOT);
  }
  state.carpetas.set("", id);
  return id;
}

// Resuelve (creando lo que falte) una ruta de carpetas bajo la raíz.
async function resolverCarpeta(segmentos) {
  let parentId = await obtenerCarpetaRaiz();
  let clave = "";
  for (const seg of segmentos) {
    clave += `/${seg}`;
    let id = state.carpetas.get(clave);
    if (!id) {
      id = await encontrarOCrearCarpeta(seg, parentId);
      state.carpetas.set(clave, id);
    }
    parentId = id;
  }
  return parentId;
}

function rutaBaseNivel(nivel = nivelActual()) {
  const cfg = configActual();
  return [cfg.anioLectivo, NIVELES[nivel].carpeta];
}

function rutaLegible(grupo = state.grupoActual, nivel = nivelActual()) {
  const cfg = configActual();
  const partes = [cfg.rootFolderName || DRIVE_ROOT, cfg.anioLectivo, NIVELES[nivel].label];
  if (grupo) partes.push(grupo);
  return partes.join(" / ");
}

// Carpetas SIGED / HD / por cédula del grupo actual (se crean si no existen).
function asegurarCarpetasGrupo() {
  const nivel = nivelActual();
  const grupo = state.grupoActual;
  if (!grupo) return Promise.reject(new Error("Selecciona un grupo primero."));
  const cfg = configActual();
  const clave = `${cfg.anioLectivo}/${nivel}/${grupo}`;
  if (state.grupoCarpetas?.clave === clave) return Promise.resolve(state.grupoCarpetas);
  if (state.grupoCarpetasPromesa?.clave === clave) return state.grupoCarpetasPromesa.promesa;
  const base = rutaBaseNivel(nivel);
  const promesa = (async () => {
    const siged = await resolverCarpeta([...base, SIGED_FOLDER_NAME, grupo]);
    const hd = await resolverCarpeta([...base, HD_FOLDER_NAME, grupo]);
    const cedula = await resolverCarpeta([...base, CEDULA_FOLDER_NAME, grupo]);
    state.grupoCarpetas = { clave, siged, hd, cedula };
    return state.grupoCarpetas;
  })().finally(() => {
    if (state.grupoCarpetasPromesa?.clave === clave) state.grupoCarpetasPromesa = null;
  });
  state.grupoCarpetasPromesa = { clave, promesa };
  return promesa;
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

async function descargarDataUrl(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
  return blobToDataUrl(await res.blob());
}

// Sube una versión de la foto. Si el estudiante ya tiene archivo en Drive,
// se actualiza ese mismo archivo (misma URL, se conserva el historial de
// versiones de Drive) y se mandan a la papelera los duplicados viejos.
async function subirVariante(mapa, carpetaId, doc, nombreArchivo, blob) {
  const ids = mapa.get(doc) ?? [];
  const armarForm = (meta) => {
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
    form.append("file", blob);
    return form;
  };
  let file = null;
  if (ids.length) {
    try {
      const res = await driveFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${ids[0]}?uploadType=multipart&supportsAllDrives=true&fields=id,modifiedTime`,
        { method: "PATCH", body: armarForm({ name: nombreArchivo }) }
      );
      file = await res.json();
    } catch (e) {
      // El archivo fue borrado por otro usuario: crear uno nuevo
      if (e.status !== 404) throw e;
      ids.length = 0;
    }
  }
  if (!file) {
    const res = await driveFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,modifiedTime",
      { method: "POST", body: armarForm({ name: nombreArchivo, parents: [carpetaId] }) }
    );
    file = await res.json();
  }
  // Borrar (papelera) las copias viejas del mismo estudiante
  for (const viejo of ids.slice(1)) {
    if (viejo === file.id) continue;
    try { await driveRequest("PATCH", `files/${viejo}`, { trashed: true }); } catch { /* ignorar */ }
  }
  mapa.set(doc, [file.id]);
  return file;
}

// Sube las tres versiones de la foto de un estudiante al grupo actual.
async function subirFotosDeEstudiante(doc, nombre, dataUrl, dataUrlHD, dataUrlMid) {
  const carpetas = await asegurarCarpetasGrupo();
  const [siged] = await Promise.all([
    subirVariante(state.driveFiles, carpetas.siged, doc, `${doc}.png`, base64ToBlob(dataUrl.split(",")[1], "image/png")),
    dataUrlHD
      ? subirVariante(state.driveHDFiles, carpetas.hd, doc, `${generarNombreHD(nombre, doc)}.jpg`, base64ToBlob(dataUrlHD.split(",")[1], "image/jpeg"))
      : Promise.resolve(null),
    dataUrlMid
      ? subirVariante(state.driveCedulaFiles, carpetas.cedula, doc, `${doc}.jpg`, base64ToBlob(dataUrlMid.split(",")[1], "image/jpeg"))
      : Promise.resolve(null)
  ]);
  const fecha = Date.parse(siged.modifiedTime) || Date.now();
  state.driveFechas.set(doc, fecha);
  const meta = state.fotosMeta.get(doc) ?? {};
  state.fotosMeta.set(doc, { ...meta, fecha, drive: true });
  console.info(`[SIGED] ${state.driveUser?.email ?? "usuario"} subió foto de ${doc} (${nombre}) → ${rutaLegible()}`);
  return siged;
}

function actualizarDrivePanel() {
  const panel = $("drive-panel");
  if (!state.driveToken) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const pathText = $("drive-path-text");
  pathText.textContent = state.grupoActual ? rutaLegible() : `${rutaLegible("")} — selecciona un grupo`;
  pathText.title = pathText.textContent;

  const modo = $("drive-modo");
  if (modo) {
    if (state.configOrigen === "drive") {
      modo.textContent = "Carpeta central del administrador";
      modo.className = "drive-modo drive-modo--central";
    } else {
      modo.textContent = "Sin configuración central · Drive personal";
      modo.className = "drive-modo drive-modo--local";
    }
  }

  const syncCount = $("drive-sync-count");
  const totalDrive = state.driveFiles.size;
  if (totalDrive > 0) {
    syncCount.textContent = `${totalDrive} foto${totalDrive !== 1 ? "s" : ""} en Drive`;
    syncCount.style.color = "var(--success)";
  } else if (state.grupoActual) {
    syncCount.textContent = "Sin fotos en Drive para este grupo";
    syncCount.style.color = "var(--muted)";
  } else {
    syncCount.textContent = "";
  }
}

// Agrupa los archivos de una carpeta por documento (más reciente primero).
function agruparPorDoc(files, extraerDoc) {
  const mapa = new Map();
  const ordenados = [...files].sort((a, b) => Date.parse(b.modifiedTime ?? 0) - Date.parse(a.modifiedTime ?? 0));
  for (const f of ordenados) {
    const doc = sanitizeDoc(extraerDoc(f.name) ?? "");
    if (!doc) continue;
    if (!mapa.has(doc)) mapa.set(doc, []);
    mapa.get(doc).push(f.id);
  }
  return { mapa, ordenados };
}

async function listarImagenes(folderId) {
  return listarArchivos(
    `'${folderId}' in parents and trashed=false and (mimeType='image/png' or mimeType='image/jpeg')`,
    "files(id,name,modifiedTime,lastModifyingUser(displayName,emailAddress))",
    { orderBy: "modifiedTime desc" }
  );
}

// Ejecuta tareas asíncronas con un máximo de concurrencia.
async function enLotes(items, limite, fn) {
  const cola = [...items];
  const trabajadores = Array.from({ length: Math.min(limite, cola.length) }, async () => {
    while (cola.length) await fn(cola.shift());
  });
  await Promise.all(trabajadores);
}

// Sincroniza el grupo con Drive: baja las fotos que tomó cualquier usuario,
// sube las que este dispositivo tiene más nuevas y arma los índices de
// archivos para poder reemplazarlos al retomar una foto.
async function sincronizarFotosDeDrive(grupoNombre) {
  if (!state.driveToken || !grupoNombre) return;
  const statusEl = $("drive-status");
  if (statusEl) statusEl.textContent = "Sincronizando…";
  actualizarDrivePanel();
  try {
    const carpetas = await asegurarCarpetasGrupo();
    if (state.grupoActual !== grupoNombre) return; // cambió el grupo mientras tanto
    const [sig, hd, ced] = await Promise.all([
      listarImagenes(carpetas.siged),
      listarImagenes(carpetas.hd),
      listarImagenes(carpetas.cedula)
    ]);
    if (state.grupoActual !== grupoNombre) return;
    const agrupSig = agruparPorDoc(sig, (n) => n.replace(/\.png$/i, ""));
    state.driveFiles = agrupSig.mapa;
    state.driveHDFiles = agruparPorDoc(hd, (n) => (n.match(/_(\d+)\.jpe?g$/i) ?? [])[1]).mapa;
    state.driveCedulaFiles = agruparPorDoc(ced, (n) => n.replace(/\.jpe?g$/i, "")).mapa;
    state.driveFechas = new Map();
    for (const f of agrupSig.ordenados) {
      const doc = sanitizeDoc(f.name.replace(/\.png$/i, ""));
      if (doc && !state.driveFechas.has(doc)) state.driveFechas.set(doc, Date.parse(f.modifiedTime) || 0);
    }
    actualizarDrivePanel();
    renderEstudiantes();

    const cfg = configActual();
    const nivel = nivelActual();
    const aDescargar = [];
    const aSubir = [];
    const TOLERANCIA = 3000;
    for (const [doc, ids] of state.driveFiles) {
      const fechaDrive = state.driveFechas.get(doc) ?? 0;
      const local = state.fotosMeta.get(doc);
      const fechaLocal = state.fotos.has(doc) ? (local?.fecha ?? 0) : -1;
      if (fechaLocal < 0 || fechaDrive > fechaLocal + TOLERANCIA) aDescargar.push({ doc, id: ids[0], fechaDrive });
    }
    // Fotos tomadas en este dispositivo (para este año) que aún no están en
    // Drive o son más nuevas que la versión de Drive
    for (const e of state.estudiantes) {
      const doc = sanitizeDoc(e.Documento);
      if (!state.fotos.has(doc)) continue;
      const local = state.fotosMeta.get(doc);
      if (!local || local.anio !== cfg.anioLectivo || local.nivel !== nivel || local.grupo !== grupoNombre) continue;
      const fechaDrive = state.driveFechas.get(doc);
      if (fechaDrive == null || local.fecha > fechaDrive + TOLERANCIA) aSubir.push({ doc, nombre: e.Nombre });
    }

    let nuevas = 0;
    await enLotes(aDescargar, 4, async ({ doc, id, fechaDrive }) => {
      try {
        state.fotos.set(doc, await descargarDataUrl(id));
        state.fotosMeta.set(doc, { fecha: fechaDrive, anio: cfg.anioLectivo, nivel, grupo: grupoNombre, origen: "drive", drive: true });
        await borrarVersionesLocales(doc);
        nuevas++;
      } catch { /* seguir con las demás */ }
    });
    if (nuevas > 0) { guardarSesion(); renderEstudiantes(); actualizarPendientesYStats(); actualizarStudentPreview(); }

    let subidas = 0;
    for (const { doc, nombre } of aSubir) {
      try {
        await subirFotosDeEstudiante(doc, nombre, state.fotos.get(doc), state.fotosHD.get(doc), state.fotosCedula.get(doc));
        subidas++;
      } catch (e) {
        console.warn("[SIGED] No se pudo subir foto pendiente", doc, e);
      }
    }
    if (subidas > 0) { guardarSesion(); renderEstudiantes(); actualizarStudentPreview(); }

    const total = state.driveFiles.size;
    if (statusEl) statusEl.textContent = `Drive ✓ · ${total} foto${total !== 1 ? "s" : ""}`;
    actualizarDrivePanel();
    const msgs = [];
    if (nuevas > 0) msgs.push(`${nuevas} descargada${nuevas !== 1 ? "s" : ""}`);
    if (subidas > 0) msgs.push(`${subidas} subida${subidas !== 1 ? "s" : ""}`);
    if (msgs.length) toast(`Drive sincronizado: ${msgs.join(", ")}.`, "success");
  } catch (err) {
    if (statusEl) statusEl.textContent = "Error de sincronización";
    toast(`Error al sincronizar con Drive: ${err.message}`, "error", 6000);
  }
}

/* ── Carga de bases de datos ─────────────────────── */
function esArchivoDatos(f) {
  return f.mimeType === GSHEET_MIME
    || /\.(xlsx|xls|csv)$/i.test(f.name ?? "")
    || /spreadsheet|excel|csv/i.test(f.mimeType ?? "");
}

async function descargarArchivoDatos(archivo) {
  if (archivo.mimeType === GSHEET_MIME) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${archivo.id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`);
    return { buffer: await res.arrayBuffer(), xlsx: true };
  }
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${archivo.id}?alt=media&supportsAllDrives=true`);
  const xlsx = /\.xlsx?$/i.test(archivo.name ?? "") || /spreadsheet|excel/i.test(archivo.mimeType ?? "");
  return { buffer: await res.arrayBuffer(), xlsx };
}

// Carga una base desde Drive. `id` puede ser una carpeta (se toma el
// XLSX/CSV más reciente) o un archivo/Google Sheets.
async function cargarBaseDesdeDrive(id, concatenarCurso) {
  const meta = await driveRequest("GET", `files/${id}`, null, {
    fields: "id,name,mimeType,modifiedTime,lastModifyingUser(displayName,emailAddress)"
  });
  let archivo = meta;
  if (meta.mimeType === FOLDER_MIME) {
    const files = await listarArchivos(
      `'${id}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`,
      "files(id,name,mimeType,modifiedTime,lastModifyingUser(displayName,emailAddress))",
      { orderBy: "modifiedTime desc", max: 100 }
    );
    const candidatos = files.filter(esArchivoDatos);
    if (!candidatos.length) throw new Error(`La carpeta "${meta.name}" no contiene archivos XLSX/CSV.`);
    archivo = candidatos[0];
  }
  const { buffer, xlsx } = await descargarArchivoDatos(archivo);
  const rows = xlsx
    ? parseXLSX(buffer, concatenarCurso)
    : parseCSV(new TextDecoder("utf-8").decode(buffer), concatenarCurso);
  return {
    rows,
    descripcion: meta.mimeType === FOLDER_MIME ? `${meta.name} / ${archivo.name}` : archivo.name,
    modificado: archivo.modifiedTime,
    modificadoPor: nombreUsuario(archivo.lastModifyingUser)
  };
}

async function cargarBaseDesdeUrlPublica(url, concatenarCurso) {
  const xlsx = esFormatoXlsx(url);
  const urlFinal = normalizarUrl(url);
  const res = await fetch(urlFinal);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = xlsx ? parseXLSX(await res.arrayBuffer(), concatenarCurso) : parseCSV(await res.text(), concatenarCurso);
  return { rows, descripcion: url.length > 50 ? url.slice(0, 47) + "…" : url };
}

function limpiarDatos() {
  state.rows = [];
  state.groups = [];
  state.grupoActual = "";
  state.estudiantes = [];
  state.seleccion = null;
  state.fuenteActual = null;
  $("grupo").innerHTML = "";
  $("grupo-actual").textContent = "No seleccionado";
  $("estudiantes").innerHTML = "";
  actualizarPendientesYStats();
  actualizarStudentPreview();
  actualizarDrivePanel();
  $("estudiante-actual").textContent = "Estudiante: Ninguno seleccionado";
}

function aplicarFilas(rows) {
  state.rows = rows;
  state.groups = [...new Set(rows.map((r) => String(r.Grupo).trim()))].filter(Boolean).sort();
  $("grupo").innerHTML = state.groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  if (state.groups.length) {
    const recordado = localStorage.getItem(`${STORAGE_GRUPO_PREFIX}${nivelActual()}`);
    $("grupo").value = state.groups.includes(recordado) ? recordado : state.groups[0];
    seleccionarGrupo();
  } else {
    limpiarDatos();
  }
}

// Carga la fuente indicada (link de Drive, URL pública) para el nivel actual.
async function cargarDesdeFuente(fuente, { silencioso = false, central = false, guardar = false } = {}) {
  const nivel = nivelActual();
  const concatenarCurso = NIVELES[nivel].concatenarCurso;
  const driveId = extraerIdDrive(fuente);
  if (!silencioso) toast("Cargando base de datos…", "info", 2000);
  let info;
  try {
    if (driveId && state.driveToken) {
      info = await cargarBaseDesdeDrive(driveId, concatenarCurso);
    } else {
      if (driveId && !/^https?:/i.test(fuente)) throw new Error("Conecta Drive para cargar esta base de datos.");
      info = await cargarBaseDesdeUrlPublica(fuente, concatenarCurso);
    }
  } catch (err) {
    if (driveId && !state.driveToken) {
      toast("Conecta Drive para cargar la base de datos de este nivel (o sube el archivo manualmente).", "error", 7000);
    } else {
      toast(`No se pudo cargar la base de ${NIVELES[nivel].label}: ${err.message}`, "error", 7000);
    }
    actualizarStatusFuente();
    return false;
  }
  if (nivelActual() !== nivel) return false; // el usuario cambió de nivel mientras cargaba
  state.fuenteActual = { ...info, central, nivel };
  aplicarFilas(info.rows);
  if (guardar) {
    localStorage.setItem(claveUrlNivel(nivel), fuente);
    $("csv-url").value = fuente;
    actualizarStatusUrl(fuente);
  }
  actualizarStatusFuente();
  toast(`${NIVELES[nivel].label}: ${info.rows.length} estudiantes en ${state.groups.length} grupos.`, "success");
  return true;
}

// Carga la base del nivel actual: primero la central del administrador,
// si no existe la URL manual guardada en este navegador.
async function cargarBaseNivel({ silencioso = false } = {}) {
  const nivel = nivelActual();
  const cfg = configActual();
  const central = cfg.niveles?.[nivel]?.fuente?.trim() ?? "";
  const manual = localStorage.getItem(claveUrlNivel(nivel)) ?? "";
  $("csv-url").value = manual;
  actualizarStatusUrl(manual);
  if (central && (state.driveToken || !extraerIdDrive(central))) {
    return cargarDesdeFuente(central, { silencioso, central: true });
  }
  if (manual) {
    return cargarDesdeFuente(manual, { silencioso });
  }
  limpiarDatos();
  actualizarStatusFuente();
  return false;
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

  // En teléfonos/tablets las fotos se toman con la cámara trasera
  const esMovil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && matchMedia("(pointer: coarse)").matches);
  select.value = esMovil ? "environment" : "user";
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
  const preview = $("preview");
  preview.srcObject = state.stream;
  // iOS a veces no arranca el video solo con autoplay
  preview.play?.().catch(() => {});

  // Re-detectar cámaras ahora que el permiso fue otorgado (labels disponibles)
  const prev = selected;
  await detectarCamaras();
  $("camara").value = prev;
}

function seleccionarGrupo() {
  const grp = $("grupo").value;
  state.grupoActual = grp;
  state.estudiantes = state.rows.filter((r) => String(r.Grupo).trim() === grp.trim());
  state.seleccion = null;
  state.driveFiles = new Map();
  state.driveHDFiles = new Map();
  state.driveCedulaFiles = new Map();
  state.driveFechas = new Map();
  if (grp) localStorage.setItem(`${STORAGE_GRUPO_PREFIX}${nivelActual()}`, grp);
  $("grupo-actual").textContent = grp || "No seleccionado";
  renderEstudiantes();
  actualizarPendientesYStats();
  actualizarStudentPreview();
  actualizarDrivePanel();
  $("estudiante-actual").textContent = "Estudiante: Ninguno seleccionado";
  // Sincronizar fotos desde Drive si hay sesión activa
  if (state.driveToken && grp) sincronizarFotosDeDrive(grp).catch(() => {});
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
      col.innerHTML = `<span class="student-name-row">${escapeHtml(nombre)} - ${escapeHtml(doc)}</span><span class="student-status-row status-done">Con foto${driveLabel}</span>`;
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
      col.innerHTML = `<span class="student-name-row">${escapeHtml(nombre)} - ${escapeHtml(doc)}</span><span class="student-status-row">Sin foto</span>`;
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
      const fecha = state.driveFechas.get(doc);
      badge.textContent = fecha ? `En Drive · ${formatoFecha(fecha)}` : "Subida a Drive";
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
  procesarYGuardarFoto(video, video.videoWidth || 320, video.videoHeight || 240, "camara");
}

// Sube una imagen elegida del dispositivo como foto del estudiante seleccionado.
async function subirFotoDesdeArchivo(file) {
  if (!file) return;
  if (!state.seleccion) return toast("Selecciona un estudiante primero.", "error");
  if (!/^image\//.test(file.type)) return toast("El archivo debe ser una imagen.", "error");
  let fuente;
  try {
    // imageOrientation aplica la rotación EXIF de las fotos de celular
    fuente = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    fuente = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo leer la imagen."));
      img.src = URL.createObjectURL(file);
    }).catch((e) => { toast(e.message, "error"); return null; });
    if (!fuente) return;
  }
  const w = fuente.width ?? fuente.naturalWidth;
  const h = fuente.height ?? fuente.naturalHeight;
  procesarYGuardarFoto(fuente, w, h, "archivo");
  fuente.close?.();
}

// Recorta al centro, genera las tres versiones, las guarda en el dispositivo
// y las sube a Drive reemplazando la foto anterior del estudiante.
function procesarYGuardarFoto(fuente, vw, vh, origen) {
  const canvas = $("captura");
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(fuente, 0, 0, vw, vh);

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
  const cfg = configActual();
  const reemplaza = state.fotos.has(doc) || state.driveFiles.has(doc);
  state.fotos.set(doc, dataUrl);
  state.fotosHD.set(doc, dataUrlHD);
  state.fotosCedula.set(doc, dataUrlMid);
  state.fotosMeta.set(doc, {
    fecha: Date.now(), anio: cfg.anioLectivo, nivel: nivelActual(), grupo: state.grupoActual, origen, drive: false
  });

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
    toast(`Foto ${reemplaza ? "reemplazada" : "guardada"}: ${nombreEst}. Subiendo a Drive…`, "info", 2000);
    (async () => {
      try {
        await subirFotosDeEstudiante(doc, nombreEst, dataUrl, dataUrlHD, dataUrlMid);
        guardarSesion();
        actualizarStudentPreview();
        actualizarDrivePanel();
        renderEstudiantes();
        toast(`${reemplaza ? "Foto reemplazada" : "Subida"} en Drive: ${doc}.png → ${rutaLegible()} (+ HD y por cédula)`, "success", 4000);
      } catch (e) {
        toast(`No se pudo subir a Drive: ${e.message}`, "error", 5000);
      }
    })();
  } else {
    toast(`Foto ${reemplaza ? "reemplazada" : "guardada"}: ${nombreEst} (SIGED + HD)`, "success");
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
  const folderSiged = zip.folder(SIGED_FOLDER_NAME);
  const folderHD = zip.folder(HD_FOLDER_NAME);
  const folderCedula = zip.folder(CEDULA_FOLDER_NAME);
  let countHD = 0;
  let countCedula = 0;
  let descargadas = 0;
  toast("Preparando ZIP…", "info", 2000);
  for (const e of state.estudiantes) {
    const doc = sanitizeDoc(e.Documento);
    if (!state.fotos.has(doc)) continue;
    // SIGED: 100x100 PNG nombrada por documento
    const data = state.fotos.get(doc).split(",")[1];
    folderSiged.file(`${doc}.png`, data, { base64: true });
    // Versiones tomadas por otros usuarios: bajarlas de Drive
    if (state.driveToken) {
      if (!state.fotosHD.has(doc) && state.driveHDFiles.has(doc)) {
        try { state.fotosHD.set(doc, await descargarDataUrl(state.driveHDFiles.get(doc)[0])); descargadas++; } catch { /* ignorar */ }
      }
      if (!state.fotosCedula.has(doc) && state.driveCedulaFiles.has(doc)) {
        try { state.fotosCedula.set(doc, await descargarDataUrl(state.driveCedulaFiles.get(doc)[0])); descargadas++; } catch { /* ignorar */ }
      }
    }
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
  if (descargadas > 0) guardarSesionHD();
  const blob = await zip.generateAsync({ type: "blob" });
  const cfg = configActual();
  const nombreZip = `${cfg.anioLectivo}_${NIVELES[nivelActual()].label}_${state.grupoActual}.zip`;
  downloadBlob(nombreZip, blob);
  const extras = [];
  if (countHD > 0) extras.push(`${countHD} HD`);
  if (countCedula > 0) extras.push(`${countCedula} por cédula`);
  const extraMsg = extras.length ? ` (+ ${extras.join(", ")})` : "";
  toast(`ZIP generado: ${nombreZip}${extraMsg}`, "success");
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
    pdf.text("N°", x + colNum / 2, hcY, { align: "center" });
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

/* ── Panel de administración ─────────────────────── */
function abrirAdmin() {
  mostrarVista("gestion");
}

function prepararConfigAdmin() {
  const cfg = configActual();
  $("adm-anio").value = cfg.anioLectivo;
  $("adm-root").value = cfg.rootFolderId ? linkCarpetaDrive(cfg.rootFolderId) : "";
  Object.keys(NIVELES).forEach((n) => { $(`adm-fuente-${n}`).value = cfg.niveles?.[n]?.fuente ?? ""; });
  $("admin-guardar-status").textContent = "";
  $("admin-guardar-status").className = "field-status";
  actualizarEstructuraAdmin();
  actualizarMetaAdmin();
}

function actualizarMetaAdmin() {
  const cfg = configActual();
  const el = $("admin-meta");
  if (state.configOrigen === "drive" && cfg.actualizadoEn) {
    el.innerHTML = `Configuración central guardada en Drive · última modificación ${escapeHtml(formatoFecha(cfg.actualizadoEn))} por ${escapeHtml(cfg.actualizadoPor || "—")}.`;
  } else {
    el.textContent = "Todavía no hay configuración central en Drive. Al guardar se creará el archivo siged-config.json en la carpeta raíz.";
  }
  const links = $("admin-links");
  const partes = [];
  if (cfg.rootFolderId) partes.push(`<a href="${linkCarpetaDrive(cfg.rootFolderId)}" target="_blank" rel="noopener">Abrir carpeta raíz en Drive</a>`);
  if (state.configFileId) partes.push(`<a href="https://drive.google.com/file/d/${state.configFileId}/view" target="_blank" rel="noopener">Ver siged-config.json</a>`);
  links.innerHTML = partes.join(" · ");
}

function actualizarEstructuraAdmin() {
  const anio = $("adm-anio").value.trim() || String(new Date().getFullYear());
  const rootTexto = $("adm-root").value.trim();
  const cfg = configActual();
  const rootNombre = rootTexto ? (extraerIdDrive(rootTexto) === cfg.rootFolderId ? cfg.rootFolderName : "(carpeta elegida)") : DRIVE_ROOT;
  $("adm-estructura").textContent = `${rootNombre} / ${anio} / Primaria / ${SIGED_FOLDER_NAME} / 3A / 12345678.png`;
}

async function guardarAdmin() {
  const btn = $("btn-admin-guardar");
  const status = $("admin-guardar-status");
  const anio = $("adm-anio").value.trim();
  if (!/^\d{4}$/.test(anio)) {
    status.textContent = "El año lectivo debe tener 4 dígitos (ej. 2026).";
    status.className = "field-status field-status--error";
    return;
  }
  const rootTexto = $("adm-root").value.trim();
  const rootId = rootTexto ? extraerIdDrive(rootTexto) : "";
  if (rootTexto && !rootId) {
    status.textContent = "El link de la carpeta raíz no es válido.";
    status.className = "field-status field-status--error";
    return;
  }
  const cfg = normalizarConfig({
    ...configActual(),
    anioLectivo: anio,
    rootFolderId: rootId,
    rootFolderName: rootId && rootId === configActual().rootFolderId ? configActual().rootFolderName : DRIVE_ROOT,
    niveles: Object.fromEntries(Object.keys(NIVELES).map((n) => [n, { fuente: $(`adm-fuente-${n}`).value.trim() }]))
  });
  btn.disabled = true;
  status.textContent = "Guardando y creando carpetas del año…";
  status.className = "field-status";
  try {
    await guardarConfiguracionCentral(cfg);
    status.textContent = `✓ Guardado. Estructura ${cfg.anioLectivo} creada en "${cfg.rootFolderName}".`;
    status.className = "field-status field-status--ok";
    $("adm-root").value = linkCarpetaDrive(cfg.rootFolderId);
    actualizarMetaAdmin();
    actualizarEstructuraAdmin();
    actualizarDrivePanel();
    toast("Configuración central guardada en Drive.", "success");
    state.registro = null;
    state.inventario = null;
    $("gz-anio").textContent = cfg.anioLectivo;
    // Recargar base y fotos con la nueva configuración
    await cargarBaseNivel({ silencioso: true });
    if (!state.rows.length && state.grupoActual) sincronizarFotosDeDrive(state.grupoActual).catch(() => {});
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.className = "field-status field-status--error";
  } finally {
    btn.disabled = false;
  }
}

// Registro de actividad: quién fue el último en subir/modificar fotos en
// cada grupo del año lectivo, según los metadatos de Drive
// (lastModifyingUser / modifiedTime de cada archivo).
// Inventario del año lectivo en Drive: carpetas de grupo por nivel y las
// fotos SIGED que contienen (una sola consulta paginada, filtrada por carpeta).
async function obtenerInventario(forzar = false) {
  const cfg = configActual();
  if (!forzar && state.inventario?.anio === cfg.anioLectivo && Date.now() - state.inventario.generado < 60000) return state.inventario;
  const rootId = await obtenerCarpetaRaiz();
  const anioId = await buscarCarpeta(cfg.anioLectivo, rootId);
  const grupos = new Map(); // folderId => info
  if (anioId) {
    for (const [key, n] of Object.entries(NIVELES)) {
      const nivelId = await buscarCarpeta(n.carpeta, anioId);
      if (!nivelId) continue;
      const sigedId = await buscarCarpeta(SIGED_FOLDER_NAME, nivelId);
      if (!sigedId) continue;
      const carpetas = await listarArchivos(
        `'${sigedId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
        "files(id,name,createdTime,lastModifyingUser(displayName,emailAddress))",
        { orderBy: "name" }
      );
      carpetas.forEach((c) => grupos.set(c.id, {
        nivelKey: key, nivel: n.label, grupo: c.name, carpetaId: c.id, creada: c.createdTime, creadaPor: nombreUsuario(c.lastModifyingUser),
        fotos: 0, ultimo: null, ultimoPor: "—", docs: []
      }));
    }
  }
  const desde = `${Number(cfg.anioLectivo) - 1}-12-01T00:00:00`;
  const fotos = grupos.size
    ? await listarArchivos(
      `mimeType='image/png' and trashed=false and modifiedTime > '${desde}'`,
      "files(id,name,parents,modifiedTime,createdTime,lastModifyingUser(displayName,emailAddress))",
      { orderBy: "modifiedTime desc", max: 5000, pageSize: 500 }
    )
    : [];
  const recientes = [];
  for (const f of fotos) {
    const padre = (f.parents ?? []).find((p) => grupos.has(p));
    if (!padre) continue;
    const g = grupos.get(padre);
    g.fotos++;
    g.docs.push(sanitizeDoc(f.name.replace(/\.png$/i, "")));
    const t = Date.parse(f.modifiedTime) || 0;
    if (!g.ultimo || t > g.ultimo) { g.ultimo = t; g.ultimoPor = nombreUsuario(f.lastModifyingUser); }
    recientes.push({ archivo: f.name, nivel: g.nivel, grupo: g.grupo, fecha: t, usuario: nombreUsuario(f.lastModifyingUser), nuevo: f.createdTime === f.modifiedTime });
  }
  state.inventario = { anio: cfg.anioLectivo, anioId, generado: Date.now(), grupos, recientes };
  return state.inventario;
}

// Registro de actividad: quién fue el último en subir/modificar fotos en
// cada grupo del año lectivo, según los metadatos de Drive
// (lastModifyingUser / modifiedTime de cada archivo).
async function cargarRegistroActividad(forzar = true) {
  const status = $("admin-registro-status");
  const btn = $("btn-admin-registro");
  btn.disabled = true;
  status.textContent = "Consultando Drive…";
  status.className = "field-status";
  try {
    const cfg = configActual();
    const inv = await obtenerInventario(forzar);
    const filas = [...inv.grupos.values()].sort((a, b) => (b.ultimo ?? 0) - (a.ultimo ?? 0));
    state.registro = { generado: Date.now(), filas, recientes: inv.recientes.slice(0, 60), totalFotos: inv.recientes.length };
    renderRegistroActividad();
    status.textContent = inv.anioId
      ? `✓ ${filas.length} grupo${filas.length !== 1 ? "s" : ""} · ${inv.recientes.length} foto${inv.recientes.length !== 1 ? "s" : ""} en ${cfg.anioLectivo} · ${formatoFecha(Date.now())}`
      : `La carpeta del año ${cfg.anioLectivo} todavía no existe en "${cfg.rootFolderName}".`;
    status.className = "field-status field-status--ok";
    console.info(`[SIGED] Registro de actividad ${cfg.anioLectivo}`);
    console.table(filas.map((f) => ({ Nivel: f.nivel, Grupo: f.grupo, Fotos: f.fotos, "Último cambio": formatoFecha(f.ultimo), "Por": f.ultimoPor })));
  } catch (e) {
    status.textContent = `No se pudo cargar el registro: ${e.message}`;
    status.className = "field-status field-status--error";
  } finally {
    btn.disabled = false;
  }
}

function renderRegistroActividad() {
  const tbody = $("admin-tabla-grupos").querySelector("tbody");
  const lista = $("admin-ultimos");
  const reg = state.registro;
  if (!reg) { tbody.innerHTML = ""; lista.innerHTML = ""; return; }
  tbody.innerHTML = reg.filas.map((f) => `
    <tr>
      <td>${escapeHtml(f.nivel)}</td>
      <td><a href="${linkCarpetaDrive(f.carpetaId)}" target="_blank" rel="noopener">${escapeHtml(f.grupo)}</a></td>
      <td class="num">${f.fotos}</td>
      <td>${escapeHtml(formatoFecha(f.ultimo))}</td>
      <td>${escapeHtml(f.ultimoPor)}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="admin-empty">Sin grupos con fotos todavía.</td></tr>`;
  lista.innerHTML = reg.recientes.map((r) => `
    <li>
      <span class="admin-log-fecha">${escapeHtml(formatoFecha(r.fecha))}</span>
      <span class="admin-log-archivo">${escapeHtml(r.archivo)}</span>
      <span class="admin-log-grupo">${escapeHtml(r.nivel)} / ${escapeHtml(r.grupo)}</span>
      <span class="admin-log-usuario">${escapeHtml(r.usuario)}${r.nuevo ? "" : " · reemplazo"}</span>
    </li>`).join("") || `<li class="admin-empty">Sin actividad registrada.</li>`;
}

/* ── Vistas (Tomar fotos / Gestión) ──────────────── */
function mostrarVista(vista) {
  if (!["fotos", "gestion"].includes(vista)) vista = "fotos";
  state.vista = vista;
  const esGestion = vista === "gestion";
  $("vista-fotos").hidden = esGestion;
  $("vista-gestion").hidden = !esGestion;
  document.body.classList.toggle("en-gestion", esGestion);
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.vista === vista));
  if (location.hash !== `#${vista}`) history.replaceState(null, "", `#${vista}`);
  if (esGestion) prepararGestion();
  window.scrollTo({ top: 0 });
}

function prepararGestion() {
  const conectado = !!state.driveToken;
  const cfg = configActual();
  $("gestion-sin-drive").hidden = conectado;
  $("g-zip").hidden = !conectado;
  $("g-migrar").hidden = !conectado;
  $("g-config").hidden = !(conectado && state.esAdmin);
  $("g-registro").hidden = !(conectado && state.esAdmin);
  $("gz-anio").textContent = cfg.anioLectivo;
  if (!$("mig-anio").value) $("mig-anio").value = cfg.anioLectivo;
  if ($("gz-nivel").value !== nivelActual() && !state.inventario) $("gz-nivel").value = nivelActual();
  if ($("mig-nivel").value !== nivelActual() && !state.migracionPlan) $("mig-nivel").value = nivelActual();
  if (!conectado) return;
  if (state.esAdmin) {
    prepararConfigAdmin();
    if (!state.registro) cargarRegistroActividad(false).catch(() => {});
  }
  if (!state.inventario) cargarGruposZip().catch(() => {});
  else renderGruposZip();
}

/* ── Gestión: ZIP por grupos desde Drive ─────────── */
const VERSIONES_ZIP = {
  hd:     { carpeta: HD_FOLDER_NAME,     ext: "jpg", extraer: (n) => (n.match(/_(\d+)\.jpe?g$/i) ?? [])[1] ?? n.replace(/\.jpe?g$/i, ""), label: "alta resolución" },
  cedula: { carpeta: CEDULA_FOLDER_NAME, ext: "jpg", extraer: (n) => n.replace(/\.jpe?g$/i, ""), label: "peso reducido" },
  siged:  { carpeta: SIGED_FOLDER_NAME,  ext: "png", extraer: (n) => n.replace(/\.png$/i, ""), label: "SIGED" }
};

async function cargarGruposZip() {
  const status = $("gz-status");
  status.textContent = "Leyendo grupos del año en Drive…";
  status.className = "field-status";
  try {
    await obtenerInventario(true);
    renderGruposZip();
    status.textContent = "";
  } catch (e) {
    status.textContent = `No se pudieron leer los grupos: ${e.message}`;
    status.className = "field-status field-status--error";
  }
}

function gruposDelNivel(nivelKey) {
  if (!state.inventario) return [];
  return [...state.inventario.grupos.values()]
    .filter((g) => g.nivelKey === nivelKey)
    .sort((a, b) => a.grupo.localeCompare(b.grupo, "es", { numeric: true }));
}

function renderGruposZip() {
  const ul = $("gz-grupos");
  const nivelKey = $("gz-nivel").value;
  const grupos = gruposDelNivel(nivelKey);
  // Conservar lo marcado si la lista se vuelve a dibujar (recarga, etc.)
  const marcados = new Set([...ul.querySelectorAll(".gz-grupo:checked")].map((cb) => cb.dataset.grupo));
  ul.innerHTML = grupos.map((g) => `
    <li>
      <label>
        <input type="checkbox" class="gz-grupo" value="${escapeHtml(g.carpetaId)}" data-grupo="${escapeHtml(g.grupo)}"${marcados.has(g.grupo) ? " checked" : ""} />
        <span class="check-nombre">${escapeHtml(g.grupo)}</span>
        <span class="check-detalle">${g.fotos} foto${g.fotos !== 1 ? "s" : ""}${g.ultimo ? ` · ${formatoFecha(g.ultimo)} · ${escapeHtml(g.ultimoPor)}` : ""}</span>
      </label>
    </li>`).join("") || `<li class="admin-empty">No hay grupos con carpeta en ${NIVELES[nivelKey].label} para ${configActual().anioLectivo}.</li>`;
  const cbs = ul.querySelectorAll(".gz-grupo");
  $("gz-todos").checked = cbs.length > 0 && [...cbs].every((cb) => cb.checked);
  actualizarResumenZip();
}

function actualizarResumenZip() {
  const marcados = [...document.querySelectorAll(".gz-grupo:checked")];
  const total = marcados.reduce((acc, cb) => acc + (state.inventario?.grupos.get(cb.value)?.fotos ?? 0), 0);
  $("gz-resumen").textContent = marcados.length
    ? `${marcados.length} grupo${marcados.length !== 1 ? "s" : ""} · ${total} estudiante${total !== 1 ? "s" : ""} con foto`
    : "Marca los grupos que quieres descargar.";
}

async function generarZipGestion() {
  const nivelKey = $("gz-nivel").value;
  const grupos = [...document.querySelectorAll(".gz-grupo:checked")].map((cb) => ({ id: cb.value, nombre: cb.dataset.grupo }));
  const versiones = Object.keys(VERSIONES_ZIP).filter((v) => $(`gz-v-${v}`).checked);
  const status = $("gz-status");
  const btn = $("btn-gz-generar");
  if (!grupos.length) { status.textContent = "Marca al menos un grupo."; status.className = "field-status field-status--error"; return; }
  if (!versiones.length) { status.textContent = "Marca al menos una versión."; status.className = "field-status field-status--error"; return; }
  const carpetaPorGrupo = $("gz-carpeta-grupo").checked;
  const cfg = configActual();
  const base = rutaBaseNivel(nivelKey);
  btn.disabled = true;
  status.className = "field-status";
  try {
    // Recolectar archivos
    const tareas = [];
    for (const g of grupos) {
      for (const v of versiones) {
        const def = VERSIONES_ZIP[v];
        const carpetaId = v === "siged" ? g.id : await buscarCarpetaRuta([...base, def.carpeta, g.nombre]);
        if (!carpetaId) continue;
        const archivos = await listarImagenes(carpetaId);
        const vistos = new Set();
        for (const f of archivos) { // más reciente primero: una foto por cédula
          const doc = sanitizeDoc(def.extraer(f.name) ?? "");
          if (!doc || vistos.has(doc)) continue;
          vistos.add(doc);
          const partes = [];
          if (versiones.length > 1) partes.push(def.carpeta);
          if (carpetaPorGrupo) partes.push(g.nombre);
          partes.push(`${doc}.${def.ext}`);
          tareas.push({ id: f.id, ruta: partes.join("/") });
        }
      }
    }
    if (!tareas.length) throw new Error("No hay fotos en Drive para los grupos y versiones elegidos.");
    const zip = new JSZip();
    let hechas = 0;
    let fallidas = 0;
    await enLotes(tareas, 4, async (t) => {
      try {
        const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${t.id}?alt=media&supportsAllDrives=true`);
        zip.file(t.ruta, await res.blob());
      } catch { fallidas++; }
      hechas++;
      status.textContent = `Descargando ${hechas}/${tareas.length}…`;
    });
    status.textContent = "Comprimiendo…";
    const blob = await zip.generateAsync({ type: "blob" });
    const nombre = `${cfg.anioLectivo}_${NIVELES[nivelKey].label}_${grupos.length === 1 ? grupos[0].nombre : "fotos"}.zip`;
    downloadBlob(nombre, blob);
    status.textContent = `✓ ${nombre} · ${tareas.length - fallidas} archivo${tareas.length - fallidas !== 1 ? "s" : ""}${fallidas ? ` · ${fallidas} con error` : ""}`;
    status.className = "field-status field-status--ok";
    toast(`ZIP generado: ${nombre}`, "success");
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.className = "field-status field-status--error";
  } finally {
    btn.disabled = false;
  }
}

// Busca una ruta de carpetas bajo la raíz sin crear nada.
async function buscarCarpetaRuta(segmentos) {
  let parentId = await obtenerCarpetaRaiz();
  let clave = "";
  for (const seg of segmentos) {
    clave += `/${seg}`;
    let id = state.carpetas.get(clave);
    if (!id) {
      id = await buscarCarpeta(seg, parentId);
      if (!id) return null;
      state.carpetas.set(clave, id);
    }
    parentId = id;
  }
  return parentId;
}

/* ── Gestión: migración de carpetas anteriores ───── */
// Estructuras reconocidas:
//  (a) versión anterior: <carpeta>/<grupo>/<doc>.png,
//      <carpeta>/imagenes de estudiantes alta resolución/<grupo>/<nombre_doc>.jpg,
//      <carpeta>/imagenes por cédula/<grupo>/<doc>.jpg
//  (b) carpeta de nivel del sistema nuevo: <carpeta>/SIGED/<grupo>, <carpeta>/<HD>/<grupo>, ...
//  (c) una sola carpeta de grupo con los PNG directamente adentro.
async function analizarCarpetaAntigua(link) {
  const id = extraerIdDrive(link);
  if (!id) throw new Error("El link no parece de una carpeta de Drive.");
  const meta = await driveRequest("GET", `files/${id}`, null, { fields: "id,name,mimeType" });
  if (meta.mimeType !== FOLDER_MIME) throw new Error("El link no corresponde a una carpeta.");
  const hijos = await listarArchivos(`'${id}' in parents and trashed=false`, "files(id,name,mimeType)", { orderBy: "name" });
  const subcarpetas = hijos.filter((h) => h.mimeType === FOLDER_MIME);
  const pngsDirectos = hijos.filter((h) => h.mimeType === "image/png");
  const porNombre = (n) => subcarpetas.find((c) => c.name === n);
  const hdRoot = porNombre(HD_FOLDER_NAME);
  const cedRoot = porNombre(CEDULA_FOLDER_NAME);
  const sigedRoot = porNombre(SIGED_FOLDER_NAME);

  let gruposSiged;
  if (sigedRoot) {
    gruposSiged = await listarArchivos(`'${sigedRoot.id}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, "files(id,name)", { orderBy: "name" });
  } else {
    gruposSiged = subcarpetas.filter((c) => ![HD_FOLDER_NAME, CEDULA_FOLDER_NAME].includes(c.name));
    if (!gruposSiged.length && pngsDirectos.length) gruposSiged = [{ id: meta.id, name: meta.name }];
  }
  if (!gruposSiged.length) throw new Error(`No se encontraron carpetas de grupo con fotos en "${meta.name}".`);

  const hdGrupos = hdRoot ? await listarArchivos(`'${hdRoot.id}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, "files(id,name)") : [];
  const cedGrupos = cedRoot ? await listarArchivos(`'${cedRoot.id}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, "files(id,name)") : [];

  const plan = [];
  for (const g of gruposSiged) {
    const hd = hdGrupos.find((c) => c.name === g.name);
    const ced = cedGrupos.find((c) => c.name === g.name);
    const [fSiged, fHD, fCed] = await Promise.all([
      listarImagenes(g.id),
      hd ? listarImagenes(hd.id) : [],
      ced ? listarImagenes(ced.id) : []
    ]);
    const siged = fSiged.filter((f) => /\.png$/i.test(f.name));
    if (!siged.length && !fHD.length && !fCed.length) continue;
    plan.push({ grupo: g.name, siged, hd: fHD, cedula: fCed });
  }
  if (!plan.length) throw new Error(`Las carpetas de "${meta.name}" no contienen fotos.`);
  return { origen: meta, plan };
}

function renderPlanMigracion() {
  const ul = $("mig-grupos");
  const plan = state.migracionPlan?.plan ?? [];
  ul.innerHTML = plan.map((g, i) => `
    <li>
      <label>
        <input type="checkbox" class="mig-grupo" value="${i}" checked />
        <span class="check-nombre">${escapeHtml(g.grupo)}</span>
        <span class="check-detalle">${g.siged.length} SIGED · ${g.hd.length} alta resolución · ${g.cedula.length} por cédula</span>
      </label>
      <span class="check-estado" id="mig-estado-${i}"></span>
    </li>`).join("");
  $("mig-todos").checked = true;
  $("btn-mig-migrar").disabled = !plan.length;
  const total = plan.reduce((a, g) => a + g.siged.length + g.hd.length + g.cedula.length, 0);
  $("mig-resumen").textContent = plan.length
    ? `${plan.length} grupo${plan.length !== 1 ? "s" : ""} en "${state.migracionPlan.origen.name}" · ${total} archivo${total !== 1 ? "s" : ""}`
    : "";
}

async function copiarArchivoDrive(fileId, nombre, carpetaId) {
  return driveRequest("POST", `files/${fileId}/copy`, { name: nombre, parents: [carpetaId] }, { fields: "id" });
}

// Copia las fotos de un grupo antiguo a la estructura <año>/<nivel>/…
async function migrarGrupo(g, { anio, nivelKey, reemplazar, avisar }) {
  const base = [anio, NIVELES[nivelKey].carpeta];
  const destinos = {
    siged:  { carpeta: await resolverCarpeta([...base, SIGED_FOLDER_NAME, g.grupo]),  archivos: g.siged,  extraer: VERSIONES_ZIP.siged.extraer },
    hd:     { carpeta: await resolverCarpeta([...base, HD_FOLDER_NAME, g.grupo]),     archivos: g.hd,     extraer: VERSIONES_ZIP.hd.extraer },
    cedula: { carpeta: await resolverCarpeta([...base, CEDULA_FOLDER_NAME, g.grupo]), archivos: g.cedula, extraer: VERSIONES_ZIP.cedula.extraer }
  };
  let copiados = 0, omitidos = 0, reemplazados = 0;
  for (const d of Object.values(destinos)) {
    if (!d.archivos.length) continue;
    const existentes = agruparPorDoc(await listarImagenes(d.carpeta), d.extraer).mapa;
    const vistos = new Set();
    for (const f of d.archivos) { // más reciente primero
      const doc = sanitizeDoc(d.extraer(f.name) ?? "");
      if (!doc || vistos.has(doc)) continue;
      vistos.add(doc);
      const viejos = existentes.get(doc) ?? [];
      if (viejos.length && !reemplazar) { omitidos++; continue; }
      await copiarArchivoDrive(f.id, f.name, d.carpeta);
      for (const v of viejos) {
        try { await driveRequest("PATCH", `files/${v}`, { trashed: true }); } catch { /* ignorar */ }
      }
      if (viejos.length) reemplazados++; else copiados++;
      avisar?.(copiados + reemplazados + omitidos);
    }
  }
  return { copiados, omitidos, reemplazados };
}

async function migrarSeleccionados() {
  const status = $("mig-status");
  const btn = $("btn-mig-migrar");
  const plan = state.migracionPlan?.plan ?? [];
  const seleccion = [...document.querySelectorAll(".mig-grupo:checked")].map((cb) => plan[Number(cb.value)]).filter(Boolean);
  const anio = $("mig-anio").value.trim();
  const nivelKey = $("mig-nivel").value;
  if (!seleccion.length) { status.textContent = "Marca al menos un grupo."; status.className = "field-status field-status--error"; return; }
  if (!/^\d{4}$/.test(anio)) { status.textContent = "El año destino debe tener 4 dígitos."; status.className = "field-status field-status--error"; return; }
  const reemplazar = $("mig-reemplazar").checked;
  const cfg = configActual();
  if (!confirm(`¿Copiar ${seleccion.length} grupo${seleccion.length !== 1 ? "s" : ""} de "${state.migracionPlan.origen.name}" a ${cfg.rootFolderName} / ${anio} / ${NIVELES[nivelKey].label}?${reemplazar ? " Las fotos existentes se reemplazarán." : ""}`)) return;
  btn.disabled = true;
  status.className = "field-status";
  const totales = { copiados: 0, omitidos: 0, reemplazados: 0 };
  let errores = 0;
  try {
    for (const g of seleccion) {
      const idx = plan.indexOf(g);
      const estado = $(`mig-estado-${idx}`);
      estado.textContent = "Migrando…";
      status.textContent = `Migrando ${g.grupo}…`;
      try {
        const r = await migrarGrupo(g, { anio, nivelKey, reemplazar, avisar: (n) => { estado.textContent = `${n}…`; } });
        totales.copiados += r.copiados; totales.omitidos += r.omitidos; totales.reemplazados += r.reemplazados;
        estado.textContent = `✓ ${r.copiados} copiadas${r.reemplazados ? `, ${r.reemplazados} reemplazadas` : ""}${r.omitidos ? `, ${r.omitidos} ya existían` : ""}`;
        console.info(`[SIGED] ${state.driveUser?.email ?? "usuario"} migró ${g.grupo} → ${anio}/${NIVELES[nivelKey].label}`, r);
      } catch (e) {
        errores++;
        estado.textContent = `✕ ${e.message}`;
      }
    }
    status.textContent = `✓ Migración terminada: ${totales.copiados} copiadas, ${totales.reemplazados} reemplazadas, ${totales.omitidos} omitidas por ya existir${errores ? `, ${errores} grupo(s) con error` : ""}.`;
    status.className = errores ? "field-status field-status--warn" : "field-status field-status--ok";
    toast("Migración terminada.", errores ? "info" : "success");
    state.inventario = null;
    state.registro = null;
    if (anio === cfg.anioLectivo) {
      cargarGruposZip().catch(() => {});
      if (state.grupoActual && nivelKey === nivelActual()) sincronizarFotosDeDrive(state.grupoActual).catch(() => {});
    }
  } finally {
    btn.disabled = false;
  }
}

function bindGestion() {
  document.querySelectorAll(".nav-btn").forEach((b) => { b.onclick = () => mostrarVista(b.dataset.vista); });
  window.addEventListener("hashchange", () => mostrarVista(location.hash.replace("#", "")));

  $("gz-nivel").onchange = renderGruposZip;
  $("btn-gz-cargar").onclick = () => cargarGruposZip();
  $("gz-todos").onchange = () => {
    document.querySelectorAll(".gz-grupo").forEach((cb) => { cb.checked = $("gz-todos").checked; });
    actualizarResumenZip();
  };
  $("gz-grupos").addEventListener("change", actualizarResumenZip);
  $("btn-gz-generar").onclick = generarZipGestion;

  $("btn-mig-analizar").onclick = async () => {
    const status = $("mig-status");
    const link = $("mig-link").value.trim();
    if (!link) { status.textContent = "Pega el link de la carpeta antigua."; status.className = "field-status field-status--error"; return; }
    status.textContent = "Analizando carpeta…";
    status.className = "field-status";
    $("btn-mig-analizar").disabled = true;
    try {
      state.migracionPlan = await analizarCarpetaAntigua(link);
      renderPlanMigracion();
      status.textContent = "Revisa los grupos detectados y pulsa \"Migrar seleccionados\".";
    } catch (e) {
      state.migracionPlan = null;
      renderPlanMigracion();
      status.textContent = `Error: ${e.message}`;
      status.className = "field-status field-status--error";
    } finally {
      $("btn-mig-analizar").disabled = false;
    }
  };
  $("mig-todos").onchange = () => {
    document.querySelectorAll(".mig-grupo").forEach((cb) => { cb.checked = $("mig-todos").checked; });
  };
  $("btn-mig-migrar").onclick = migrarSeleccionados;
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
    const concatenarCurso = NIVELES[nivelActual()].concatenarCurso;
    let rows;
    try {
      if (isXlsx) {
        const buffer = await file.arrayBuffer();
        rows = parseXLSX(buffer, concatenarCurso);
      } else {
        const text = await file.text();
        rows = parseCSV(text, concatenarCurso);
      }
    } catch (err) {
      return toast(err.message, "error", 5000);
    }
    state.fuenteActual = { descripcion: `Archivo local ${file.name}`, central: false, nivel: nivelActual() };
    aplicarFilas(rows);
    actualizarStatusFuente();
    toast(`Datos cargados: ${rows.length} estudiantes en ${state.groups.length} grupos.`, "info");
  };

  $("btn-cargar-url").onclick = () => {
    const url = $("csv-url").value.trim();
    if (!url) return toast("Pega una URL válida primero.", "error");
    cargarDesdeFuente(url, { guardar: true });
  };

  $("btn-olvidar-url").onclick = () => {
    localStorage.removeItem(claveUrlNivel());
    $("csv-url").value = "";
    actualizarStatusUrl(null);
    toast(`URL manual de ${NIVELES[nivelActual()].label} eliminada del navegador.`, "info");
  };

  $("btn-recargar-base").onclick = () => cargarBaseNivel();

  $("nivel").onchange = () => {
    localStorage.setItem(STORAGE_NIVEL_KEY, nivelActual());
    state.grupoCarpetas = null;
    limpiarDatos();
    cargarBaseNivel({ silencioso: true });
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

  // Administración (vista Gestión)
  $("btn-admin-guardar").onclick = guardarAdmin;
  $("btn-admin-registro").onclick = () => cargarRegistroActividad();
  $("adm-anio").oninput = actualizarEstructuraAdmin;
  $("adm-root").oninput = actualizarEstructuraAdmin;

  $("btn-seleccionar").onclick = seleccionarGrupo;
  $("buscar").oninput = renderEstudiantes;
  $("btn-guardar").onclick = guardarFoto;
  $("btn-finalizar").onclick = comprimirGrupo;
  $("btn-asistencia").onclick = generarPdfAsistencia;
  $("btn-estado").onclick = exportarEstado;
  $("btn-todos").onclick = exportarTodos;

  // Capturar button (auto-activates camera if needed, then captures)
  $("btn-capturar").onclick = capturarFoto;

  // Subir foto desde archivo
  $("btn-subir-foto").onclick = () => {
    if (!state.seleccion) return toast("Selecciona un estudiante primero.", "error");
    $("foto-archivo").click();
  };
  $("foto-archivo").onchange = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    try { await subirFotoDesdeArchivo(file); } catch (e) { toast(`No se pudo procesar la imagen: ${e.message}`, "error"); }
  };

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
  bindGestion();
  initHelp();
  mostrarVista(location.hash.replace("#", "") || "fotos");

  // Restaurar fotos guardadas en el navegador
  await restaurarSesion();
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

  // Configuración central en caché (la versión fresca se lee al conectar Drive)
  try {
    const cache = JSON.parse(localStorage.getItem(STORAGE_CONFIG_CACHE) ?? "null");
    if (cache) { state.config = normalizarConfig(cache); state.configOrigen = "cache"; }
  } catch { /* caché corrupta — ignorar */ }

  // Restaurar nivel guardado
  const savedNivel = localStorage.getItem(STORAGE_NIVEL_KEY);
  if (savedNivel && savedNivel in NIVELES) $("nivel").value = savedNivel;

  // Cargar lo que se pueda sin Drive (URL manual pública); las bases en
  // Drive se cargan al conectar.
  await cargarBaseNivel({ silencioso: true });

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
