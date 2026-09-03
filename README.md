# Fotos-Siged (GitHub Pages)

Aplicación web 100% cliente para gestionar fotos estudiantiles directamente desde GitHub Pages, con Google Drive como almacenamiento central compartido.

## Qué hace

- Carga la base de estudiantes (CSV/XLSX de SIGED, columnas `Grupo`, `Documento`, `Nombre`, saltando las 2 primeras filas) desde la carpeta de Drive que configuró el administrador para cada nivel: **Inicial**, **Primaria** y **Secundaria**.
- Detecta cámaras y permite vista previa en vivo, o subir una foto desde un archivo del dispositivo.
- Al guardar una foto genera tres versiones:
  - 100x100 px para SIGED (nombrada por documento).
  - 1080x1080 px en alta resolución (nombrada `nombre_apellido_cédula`).
  - 600x600 px de peso reducido (nombrada solo con la cédula) para subir a otros sistemas.
- Sube las tres versiones a Drive de forma automática. Si el estudiante ya tenía foto, **se reemplaza el mismo archivo** y las copias viejas van a la papelera: nunca quedan duplicados.
- Al conectar Drive, cada usuario carga automáticamente la configuración central, la base de datos del nivel y las fotos que ya tomó cualquier otro usuario del grupo.
- Exporta ZIP del grupo (con las tres carpetas), PDF de asistencia, PDF de estado y PDF de todos los grupos.
- Panel de administración (solo para cuentas administradoras) con configuración central y registro de actividad.

## Estructura de carpetas en Drive

Cada año lectivo tiene su carpeta, y dentro se generan todas las subcarpetas de trabajo:

```
SIGED Fotos/                      ← carpeta raíz (configurable por el administrador)
└── 2026/                         ← año lectivo
    ├── Inicial/
    ├── Primaria/
    │   ├── SIGED/<grupo>/<documento>.png
    │   ├── imagenes de estudiantes alta resolución/<grupo>/<nombre_apellido_cédula>.jpg
    │   └── imagenes por cédula/<grupo>/<documento>.jpg
    └── Secundaria/
```

La configuración vive en `siged-config.json`, dentro de la carpeta raíz. Se crea desde el panel de administración y todos los usuarios con acceso a la carpeta la leen al conectar Drive.

## Administración

1. Conecta Drive con una cuenta administradora (lista `ADMIN_EMAILS` en `app.js`).
2. Pulsa **Admin** en el encabezado.
3. Define el **año lectivo**, la **carpeta raíz** (link de Drive o vacío para crear `SIGED Fotos`) y, para cada nivel, el link de una **carpeta** (se usa el XLSX/CSV más reciente) o de un archivo/Google Sheets con la exportación de SIGED.
4. Guarda: se crea `siged-config.json` y la estructura del año en Drive.
5. Comparte la carpeta raíz con permiso de **editor** a las personas que sacan fotos.

El **Registro de actividad** muestra, por nivel y grupo, cuántas fotos hay, cuándo fue el último cambio y quién lo hizo (tomado de los metadatos de Drive de cada archivo), además de la lista de las últimas fotos subidas o reemplazadas. El mismo registro se imprime en la consola del navegador.

## Google Cloud (OAuth)

La app pide el permiso completo de Drive (`https://www.googleapis.com/auth/drive`) porque necesita leer y escribir en carpetas compartidas por el administrador. En Google Cloud Console:

- Habilita **Google Drive API**.
- Crea un **ID de cliente OAuth 2.0** de tipo *Aplicación web* con el dominio de GitHub Pages en "Orígenes de JavaScript autorizados".
- Configura la pantalla de consentimiento como **Interno** (Google Workspace) para no necesitar verificación de Google con ese permiso. Si es *Externo*, agrega a los usuarios como testers o completa la verificación.

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
- Las fotos se guardan en el navegador (IndexedDB) y en Drive; al conectar Drive gana siempre la versión más nueva.
- La carga manual de datos (archivo local o URL) sigue disponible como respaldo dentro de "Carga manual".
- El acceso a cámara requiere HTTPS (GitHub Pages ya lo ofrece).
