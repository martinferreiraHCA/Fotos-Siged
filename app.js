const PHOTO_WIDTH = 100;
const PHOTO_HEIGHT = 100;

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
  fotos: new Map(), // documento => dataURL
  stream: null,
  currentDevices: [],
  // Google Drive
  driveToken:    null,
  driveUser:     null,
  driveFolderId: null,
  driveGrupoId:  null,
  driveFiles:    new Map() // documento => fileId en Drive
};

const helpText = {
  "panel-info":        { title: "Información general",     body: "Muestra resumen del grupo: cuántos estudiantes hay, cuántos tienen foto y el progreso general." },
  "ultima-foto":       { title: "Última foto tomada",      body: "Presenta una miniatura de la foto más reciente y el nombre/documento del estudiante asociado." },
  "activar-camara":    { title: "Activar cámara",          body: "Solicita permisos de cámara al navegador y habilita la vista previa en tiempo real." },
  "cargar-csv":        { title: "Cargar archivo CSV",      body: "Lee un CSV local (sin subirlo a internet), detecta grupos y prepara la lista de estudiantes." },
  "seleccionar-grupo": { title: "Seleccionar grupo",       body: "Filtra estudiantes por grupo y reinicia la vista para trabajar solo con ese grupo." },
  "guardar-foto":      { title: "Guardar foto",            body: "Captura el frame actual de la cámara, lo redimensiona a 100×100 px y lo asocia al estudiante seleccionado." },
  "comprimir":         { title: "Generar ZIP del grupo",   body: "Genera un ZIP descargable con las fotos del grupo actual para enviarlo o archivarlo." },
  "cargar-url":        { title: "URL fija del CSV",        body: "Pega el link de tu Google Sheets (compartido como público) o de un archivo CSV en GitHub Raw. La app convierte el link automáticamente y guarda la URL en el navegador para cargarla sola la próxima vez." }
};

const $ = (id) => document.getElementById(id);
const STORAGE_URL_KEY    = "siged_csv_url";
const STORAGE_FOTOS_KEY  = "siged_fotos";
const STORAGE_GCLIENT_KEY = "siged_google_client_id";
const DRIVE_ROOT          = "SIGED Fotos";
const DEFAULT_CLIENT_ID   = "263672487463-bf0e1fn8k66tnvsfld7dtnmmd5ag6t46.apps.googleusercontent.com";
let tokenClient = null;

function sanitizeDoc(value) {
  return String(value ?? "").replace(/[.-]/g, "").trim();
}

/* ── URL helpers ──────────────────────────────────── */
function normalizarUrl(url) {
  url = url.trim();

  // Google Sheets: cualquier URL de edición/vista → URL de exportación CSV
  const sheetsMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetsMatch) {
    const id = sheetsMatch[1];
    const gidMatch = url.match(/[#?&]gid=(\d+)/);
    const gid = gidMatch ? `&gid=${gidMatch[1]}` : "";
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid}`;
  }

  // GitHub: URL de blob → URL raw
  const ghMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)/);
  if (ghMatch) {
    return `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}`;
  }

  return url;
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
  localStorage.removeItem(STORAGE_FOTOS_KEY);
  actualizarInfoSesion();
  renderEstudiantes();
  actualizarPendientesYStats();
  $("ultima-foto").getContext("2d").clearRect(0, 0, 150, 150);
  $("ultimo-estudiante").textContent = "Ninguna foto tomada.";
  actualizarStudentPreview();
  toast("Sesión limpiada. Todas las fotos borradas del navegador.", "info");
}

/* ── Google Drive / Auth ──────────────────────────── */
function obtenerClientId() {
  return localStorage.getItem(STORAGE_GCLIENT_KEY) ?? DEFAULT_CLIENT_ID;
}

function inicializarGIS(clientId) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: "https://www.googleapis.com/auth/drive.file profile email",
    callback: async (response) => {
      if (response.error) {
        toast(`Error de autenticación: ${response.error}`, "error");
        return;
      }
      state.driveToken = response.access_token;
      await obtenerInfoUsuario().catch(() => {});
      actualizarUIUsuario();
      if (state.grupoActual) sincronizarFotosDeDrive(state.grupoActual).catch(() => {});
    }
  });
}

async function obtenerInfoUsuario() {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${state.driveToken}` }
  });
  state.driveUser = await res.json();
}

function loginConGoogle() {
  const clientId = obtenerClientId();
  if (!clientId) { $("config-drive-modal").showModal(); return; }
  if (!window.google?.accounts?.oauth2) {
    toast("Google Sign-In aún cargando, intenta en un momento.", "info");
    return;
  }
  if (!tokenClient) inicializarGIS(clientId);
  tokenClient.requestAccessToken({ prompt: state.driveToken ? "" : "select_account" });
}

function logoutGoogle() {
  if (state.driveToken) google.accounts.oauth2.revoke(state.driveToken, () => {});
  state.driveToken    = null;
  state.driveUser     = null;
  state.driveFolderId = null;
  state.driveGrupoId  = null;
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
async function driveRequest(method, path, body = null, params = {}) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const init = { method, headers: { Authorization: `Bearer ${state.driveToken}` } };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 401) throw new Error("Token expirado. Vuelve a iniciar sesión con Google.");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
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
  if (!state.driveToken) return;
  // Auto-crear carpetas si no existen
  if (!state.driveFolderId) {
    state.driveFolderId = await encontrarOCrearCarpeta(DRIVE_ROOT);
  }
  if (!state.driveGrupoId && state.grupoActual) {
    state.driveGrupoId = await encontrarOCrearCarpeta(state.grupoActual, state.driveFolderId);
    actualizarDrivePanel();
  }
  if (!state.driveGrupoId) return;

  const blob = base64ToBlob(dataUrl.split(",")[1]);
  const existingId = state.driveFiles.get(doc);
  if (existingId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
      { method: "PATCH", headers: { Authorization: `Bearer ${state.driveToken}`, "Content-Type": "image/png" }, body: blob }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } else {
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({
      name: `${doc}.png`, parents: [state.driveGrupoId]
    })], { type: "application/json" }));
    form.append("file", blob);
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", headers: { Authorization: `Bearer ${state.driveToken}` }, body: form }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = await res.json();
    if (file.id) state.driveFiles.set(doc, file.id);
  }
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
    state.driveFiles.clear();
    actualizarDrivePanel();

    const q = `'${state.driveGrupoId}' in parents and trashed=false and mimeType='image/png'`;
    const { files = [] } = await driveRequest("GET", "files", null, { q, fields: "files(id,name)" });

    let nuevas = 0;
    for (const file of files) {
      const doc = file.name.replace(/\.png$/i, "");
      state.driveFiles.set(doc, file.id);
      if (!state.fotos.has(doc)) {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
          headers: { Authorization: `Bearer ${state.driveToken}` }
        });
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
  const urlFinal = normalizarUrl(url);
  if (!silencioso) toast("Cargando CSV desde URL…", "info", 2000);
  try {
    const res = await fetch(urlFinal);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    state.rows = parseCSV(text);
    state.groups = [...new Set(state.rows.map((r) => String(r.Grupo).trim()))].filter(Boolean).sort();
    $("grupo").innerHTML = state.groups.map((g) => `<option value="${g}">${g}</option>`).join("");
    if (state.groups.length) {
      $("grupo").value = state.groups[0];
      seleccionarGrupo();
    }
    localStorage.setItem(STORAGE_URL_KEY, url);
    $("csv-url").value = url;
    actualizarStatusUrl(url);
    toast(`CSV cargado: ${state.rows.length} estudiantes en ${state.groups.length} grupos.`, "success");
  } catch (err) {
    toast(`No se pudo cargar el CSV: ${err.message}`, "error", 6000);
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

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const useful = lines.slice(2);
  if (!useful.length) return [];
  const headers = parseCsvLine(useful[0]);
  const idxGrupo = headers.indexOf("Grupo");
  const idxDocumento = headers.indexOf("Documento");
  const idxNombre = headers.indexOf("Nombre");
  if ([idxGrupo, idxDocumento, idxNombre].some((idx) => idx < 0)) {
    throw new Error("CSV inválido: requiere columnas Grupo, Documento y Nombre.");
  }
  return useful.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      Grupo: cols[idxGrupo] ?? "",
      Documento: cols[idxDocumento] ?? "",
      Nombre: cols[idxNombre] ?? ""
    };
  }).filter((r) => r.Grupo || r.Documento || r.Nombre);
}

async function detectarCamaras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  state.currentDevices = devices.filter((d) => d.kind === "videoinput");
  const select = $("camara");
  select.innerHTML = "";
  state.currentDevices.forEach((d, idx) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Cámara ${idx}`;
    select.appendChild(opt);
  });
}

async function activarCamara() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  const deviceId = $("camara").value;
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId }, width: 320, height: 240 } : { width: 320, height: 240 },
    audio: false
  });
  $("preview").srcObject = state.stream;
}

function seleccionarGrupo() {
  const grp = $("grupo").value;
  state.grupoActual = grp;
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
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const out = document.createElement("canvas");
  out.width = PHOTO_WIDTH;
  out.height = PHOTO_HEIGHT;
  out.getContext("2d").drawImage(canvas, 0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  const dataUrl = out.toDataURL("image/png");

  const doc = sanitizeDoc(state.seleccion.Documento);
  state.fotos.set(doc, dataUrl);

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

  // Subir a Drive automáticamente si hay sesión activa
  if (state.driveToken) {
    toast(`Foto guardada: ${nombreEst}. Subiendo a Drive…`, "info", 2000);
    subirFotoADrive(doc, dataUrl).then(() => {
      actualizarStudentPreview();
      actualizarDrivePanel();
      renderEstudiantes();
      const ruta = state.grupoActual ? `${DRIVE_ROOT} / ${state.grupoActual}` : DRIVE_ROOT;
      toast(`Subida a Drive: ${doc}.png → ${ruta}`, "success", 4000);
    }).catch((e) => toast(`No se pudo subir a Drive: ${e.message}`, "error", 5000));
  } else {
    toast(`Foto guardada: ${nombreEst}`, "success");
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
  for (const e of state.estudiantes) {
    const doc = sanitizeDoc(e.Documento);
    if (!state.fotos.has(doc)) continue;
    const data = state.fotos.get(doc).split(",")[1];
    zip.file(`${doc}.png`, data, { base64: true });
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(`${state.grupoActual}.zip`, blob);
  toast(`ZIP generado: ${state.grupoActual}.zip`, "success");
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

function exportarEstado() {
  if (!state.grupoActual) return toast("Selecciona un grupo primero.", "error");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const total = state.estudiantes.length;
  const conFoto = state.estudiantes.filter((e) => state.fotos.has(sanitizeDoc(e.Documento))).length;
  const sin = total - conFoto;
  const pct = total ? Math.round((conFoto / total) * 100) : 0;
  const hoy = new Date().toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });

  const colNum = 10;
  const colEstado = 22;
  const colNombre = pw - margin * 2 - colNum - colEstado;
  const rowH = 7.5;
  const headerH = 8;

  // Espacio para encabezado + resumen + cabecera tabla
  const espacioEncabezado = 52;
  const espacioPie = 14;
  const filasPorPrimeraPag = Math.floor((ph - margin - espacioEncabezado - headerH - espacioPie) / rowH);
  const filasPorPagSig = Math.floor((ph - margin - 28 - headerH - espacioPie) / rowH);
  const totalPaginas = total <= filasPorPrimeraPag ? 1 : 1 + Math.ceil((total - filasPorPrimeraPag) / filasPorPagSig);

  let estudianteIdx = 0;

  for (let p = 0; p < totalPaginas; p++) {
    if (p > 0) pdf.addPage();
    let y = margin;

    if (p === 0) {
      // Título
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);
      pdf.text("ESTADO ACTUAL - REGISTRO FOTOGRAFICO", pw / 2, y, { align: "center" });

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      y += 8;
      pdf.text(`Grupo: ${state.grupoActual}`, margin, y);
      pdf.text(`Fecha: ${hoy}`, pw - margin, y, { align: "right" });
      y += 6;

      // Resumen en recuadro
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.3);
      pdf.setFillColor(245, 245, 245);
      const resH = 16;
      pdf.rect(margin, y, pw - margin * 2, resH, "FD");
      const colW = (pw - margin * 2) / 4;
      const resY = y + resH / 2 + 1.5;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.text(`Total: ${total}`, margin + colW * 0 + colW / 2, resY, { align: "center" });
      pdf.text(`Con foto: ${conFoto}`, margin + colW * 1 + colW / 2, resY, { align: "center" });
      pdf.text(`Pendientes: ${sin}`, margin + colW * 2 + colW / 2, resY, { align: "center" });
      pdf.text(`Progreso: ${pct}%`, margin + colW * 3 + colW / 2, resY, { align: "center" });
      // Separadores verticales
      pdf.setDrawColor(190, 190, 190);
      pdf.setLineWidth(0.15);
      for (let c = 1; c < 4; c++) pdf.line(margin + colW * c, y, margin + colW * c, y + resH);

      // Barra de progreso
      y += resH + 4;
      const barW = pw - margin * 2;
      const barH = 4;
      pdf.setFillColor(230, 230, 230);
      pdf.rect(margin, y, barW, barH, "F");
      if (pct > 0) {
        pdf.setFillColor(60, 60, 60);
        pdf.rect(margin, y, barW * (pct / 100), barH, "F");
      }
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.2);
      pdf.rect(margin, y, barW, barH, "S");

      y += barH + 5;
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.4);
      pdf.line(margin, y, pw - margin, y);
      y += 4;
    } else {
      // Encabezado páginas siguientes
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`ESTADO ACTUAL - ${state.grupoActual}`, pw / 2, y, { align: "center" });
      y += 6;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text(`Fecha: ${hoy}`, margin, y);
      if (totalPaginas > 1) pdf.text(`Pag. ${p + 1}/${totalPaginas}`, pw - margin, y, { align: "right" });
      y += 6;
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.4);
      pdf.line(margin, y, pw - margin, y);
      y += 4;
    }

    // Cabecera de tabla
    pdf.setFillColor(230, 230, 230);
    pdf.rect(margin, y, pw - margin * 2, headerH, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(0, 0, 0);
    const hcY = y + headerH / 2 + 1.5;
    let x = margin;
    pdf.text("N\u00b0", x + colNum / 2, hcY, { align: "center" });
    x += colNum;
    pdf.line(x, y, x, y + headerH);
    pdf.text("NOMBRE - DOCUMENTO", x + 2, hcY);
    x += colNombre;
    pdf.line(x, y, x, y + headerH);
    pdf.text("ESTADO", x + colEstado / 2, hcY, { align: "center" });
    y += headerH;

    // Filas
    const filasPag = p === 0 ? filasPorPrimeraPag : filasPorPagSig;
    const fin = Math.min(estudianteIdx + filasPag, total);
    const tablaInicio = y;

    for (let i = estudianteIdx; i < fin; i++) {
      const e = state.estudiantes[i];
      const doc = sanitizeDoc(e.Documento);
      const nombre = String(e.Nombre).trim();
      const tiene = state.fotos.has(doc);
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
      const textoCorto = texto.length > 60 ? texto.substring(0, 58) + "..." : texto;
      pdf.text(textoCorto, x + 2, cY);
      x += colNombre;
      pdf.line(x, y, x, y + rowH);

      // Estado
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      if (tiene) {
        pdf.setTextColor(0, 0, 0);
        pdf.text("\u2713", x + colEstado / 2, cY, { align: "center" });
      } else {
        pdf.setTextColor(120, 120, 120);
        pdf.text("PEND.", x + colEstado / 2, cY, { align: "center" });
      }
      pdf.setTextColor(0, 0, 0);

      y += rowH;
    }

    // Borde exterior tabla
    const tablaAlto = headerH + (fin - estudianteIdx) * rowH;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.4);
    pdf.rect(margin, tablaInicio - headerH, pw - margin * 2, tablaAlto + headerH, "S");

    // Paginación en primera página
    if (p === 0 && totalPaginas > 1) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(`Pag. 1/${totalPaginas}`, pw - margin, y + 4, { align: "right" });
    }

    estudianteIdx = fin;
  }

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
    const text = await file.text();
    try {
      state.rows = parseCSV(text);
    } catch (err) {
      return toast(err.message, "error", 5000);
    }
    state.groups = [...new Set(state.rows.map((r) => String(r.Grupo).trim()))].filter(Boolean).sort();
    $("grupo").innerHTML = state.groups.map((g) => `<option value="${g}">${g}</option>`).join("");
    if (state.groups.length) {
      $("grupo").value = state.groups[0];
      seleccionarGrupo();
      toast(`CSV cargado: ${state.rows.length} estudiantes en ${state.groups.length} grupos.`, "info");
    }
  };

  $("btn-cargar-url").onclick = () => {
    const url = $("csv-url").value.trim();
    if (!url) return toast("Pega una URL válida primero.", "error");
    cargarDesdeUrl(url);
  };

  $("btn-olvidar-url").onclick = () => {
    localStorage.removeItem(STORAGE_URL_KEY);
    $("csv-url").value = "";
    actualizarStatusUrl(null);
    toast("URL eliminada del navegador.", "info");
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
  actualizarInfoSesion();

  // Restaurar URL guardada y auto-cargar CSV
  const savedUrl = localStorage.getItem(STORAGE_URL_KEY);
  if (savedUrl) {
    $("csv-url").value = savedUrl;
    actualizarStatusUrl(savedUrl);
    await cargarDesdeUrl(savedUrl, true);
  }

  // Pre-inicializar GIS si ya hay Client ID guardado
  const clientId = obtenerClientId();
  if (clientId) {
    // Esperar a que GIS cargue (puede tardar un momento con defer)
    const waitForGIS = () => new Promise((resolve) => {
      if (window.google?.accounts?.oauth2) { resolve(); return; }
      const t = setInterval(() => { if (window.google?.accounts?.oauth2) { clearInterval(t); resolve(); } }, 200);
      setTimeout(() => { clearInterval(t); resolve(); }, 5000);
    });
    waitForGIS().then(() => {
      if (window.google?.accounts?.oauth2) inicializarGIS(clientId);
    });
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Este navegador no soporta acceso a cámara.", "error", 5000);
    return;
  }
  await detectarCamaras().catch(() => {});
})();
