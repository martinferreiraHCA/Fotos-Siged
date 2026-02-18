const PHOTO_WIDTH = 100;
const PHOTO_HEIGHT = 100;

const state = {
  rows: [],
  groups: [],
  grupoActual: "",
  estudiantes: [],
  seleccion: null,
  fotos: new Map(), // documento => dataURL
  stream: null,
  currentDevices: []
};

const helpText = {
  "panel-info": "Muestra resumen del grupo: cuántos estudiantes hay, cuántos tienen foto y el progreso general.",
  "ultima-foto": "Presenta una miniatura de la foto más reciente y el nombre/documento del estudiante asociado.",
  "activar-camara": "Solicita permisos de cámara al navegador y habilita la vista previa en tiempo real.",
  "cargar-csv": "Lee un CSV local (sin subirlo a internet), detecta grupos y prepara la lista de estudiantes.",
  "seleccionar-grupo": "Filtra estudiantes por grupo y reinicia la vista para trabajar solo con ese grupo.",
  "guardar-foto": "Captura el frame actual de la cámara, lo redimensiona a 100x100 y lo asocia al estudiante seleccionado.",
  "comprimir": "Genera un ZIP descargable con las fotos del grupo actual para enviarlo o archivarlo."
};

const $ = (id) => document.getElementById(id);

function sanitizeDoc(value) {
  return String(value ?? "").replace(/[.-]/g, "").trim();
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
  $("estudiante-actual").textContent = "Estudiante: Ninguno seleccionado";
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
    li.textContent = `${nombre} - ${doc}${state.fotos.has(doc) ? " ✅" : ""}`;
    if (state.fotos.has(doc)) li.classList.add("done");
    if (state.seleccion && sanitizeDoc(state.seleccion.Documento) === doc) li.classList.add("selected");
    li.onclick = () => {
      state.seleccion = state.estudiantes[idx];
      const estado = state.fotos.has(doc) ? "CON FOTO ✅" : "SIN FOTO ❌";
      $("estudiante-actual").textContent = `Estudiante: ${nombre} - ${doc} - ${estado}`;
      renderEstudiantes();
    };
    ul.appendChild(li);
  });
}

function guardarFoto() {
  if (!state.seleccion) return alert("Selecciona un estudiante.");
  if (!state.stream) return alert("Activa la cámara primero.");
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
  if (!state.grupoActual) return alert("Selecciona un grupo.");
  const zip = new JSZip();
  for (const e of state.estudiantes) {
    const doc = sanitizeDoc(e.Documento);
    if (!state.fotos.has(doc)) continue;
    const data = state.fotos.get(doc).split(",")[1];
    zip.file(`${doc}.png`, data, { base64: true });
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(`${state.grupoActual}.zip`, blob);
}

function generarPdfAsistencia() {
  if (!state.grupoActual) return alert("Selecciona un grupo.");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  pdf.setFontSize(14);
  pdf.text(`Lista de Asistencia - Grupo ${state.grupoActual}`, 10, 15);
  pdf.setFontSize(10);
  let y = 30;
  state.estudiantes.forEach((e, i) => {
    if (y > 280) { pdf.addPage(); y = 20; }
    const doc = sanitizeDoc(e.Documento);
    pdf.text(`${i + 1}. ${e.Nombre} - ${doc}   Firma: __________   [ ]`, 10, y);
    y += 8;
  });
  pdf.save(`asistencia_${state.grupoActual}.pdf`);
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
  if (!state.grupoActual) return alert("Selecciona un grupo.");
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
}

function exportarTodos() {
  if (!state.rows.length) return alert("Carga CSV primero.");
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
}

function initHelp() {
  const dlg = $("help-modal");
  document.querySelectorAll(".help-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.help;
      $("help-title").textContent = `Ayuda: ${key}`;
      $("help-body").textContent = helpText[key] || "Sin descripción.";
      dlg.showModal();
    });
  });
}

function bindEvents() {
  $("btn-activar").onclick = () => activarCamara().catch((e) => alert(`No se pudo activar cámara: ${e.message}`));
  $("csv-file").onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    state.rows = parseCSV(text);
    state.groups = [...new Set(state.rows.map((r) => String(r.Grupo).trim()))].filter(Boolean).sort();
    $("grupo").innerHTML = state.groups.map((g) => `<option value="${g}">${g}</option>`).join("");
    if (state.groups.length) {
      $("grupo").value = state.groups[0];
      seleccionarGrupo();
    }
  };
  $("btn-seleccionar").onclick = seleccionarGrupo;
  $("buscar").oninput = renderEstudiantes;
  $("btn-guardar").onclick = guardarFoto;
  $("btn-finalizar").onclick = comprimirGrupo;
  $("btn-asistencia").onclick = generarPdfAsistencia;
  $("btn-estado").onclick = exportarEstado;
  $("btn-todos").onclick = exportarTodos;
}

(async function init() {
  bindEvents();
  initHelp();
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Este navegador no soporta acceso a cámara.");
    return;
  }
  await detectarCamaras().catch(() => {});
})();
