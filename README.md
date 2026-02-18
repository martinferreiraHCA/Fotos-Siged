# Fotos-Siged (GitHub Pages)

Aplicación web 100% cliente para gestionar fotos estudiantiles directamente desde GitHub Pages.

## Qué hace

- Carga un CSV con columnas `Grupo`, `Documento`, `Nombre` (saltando las 2 primeras filas, como en tu script).
- Detecta cámaras y permite vista previa en vivo.
- Permite seleccionar estudiante, tomar foto y guardarla en memoria (100x100 px).
- Muestra progreso, pendientes y última foto.
- Exporta:
  - ZIP con fotos del grupo actual.
  - PDF de asistencia.
  - PDF de estado con gráfico.
  - PDF de todos los grupos.
- Incluye botones `?` pequeños para explicar cada función dentro de la UI.

## Ejecutar local

Abre `index.html` con un servidor estático (recomendado para cámara):

```bash
python -m http.server 8000
```

Luego visita `http://localhost:8000`.

## Publicar en GitHub Pages

1. Sube estos archivos al repositorio.
2. Ve a **Settings → Pages**.
3. En **Build and deployment**, elige **Deploy from a branch**.
4. Selecciona rama (por ejemplo `main`) y carpeta `/ (root)`.
5. Guarda y espera el link público.

## Notas técnicas

- Todo se procesa en el navegador; no hay backend.
- Las fotos se mantienen en memoria durante la sesión; para persistir, descarga ZIP/PDF.
- El acceso a cámara requiere HTTPS (GitHub Pages ya lo ofrece).
