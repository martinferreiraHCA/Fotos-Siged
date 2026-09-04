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
- Sección **Gestión** (menú superior), separada de la toma de fotos:
  - Descarga en ZIP de las fotos que están en Drive, eligiendo nivel, grupos (checkboxes) y versiones; dentro del ZIP cada archivo se llama solo con la cédula.
  - Migración de carpetas de versiones anteriores: se pega el link de la carpeta vieja y se copian las fotos (SIGED, alta resolución y por cédula) a la estructura del año.
  - Personas con acceso a Gestión (emails institucionales @hca.edu.uy), configuración central y registro de actividad.
  - Toda la sección es visible solo para administradores; el resto de usuarios ve únicamente Tomar fotos.

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

## Gestión

El menú superior tiene dos secciones: **Tomar fotos** y **Gestión**. La pestaña Gestión solo aparece para administradores con Drive conectado: los administradores principales (lista `ADMIN_EMAILS` en `app.js`) y las personas agregadas desde la propia sección.

- **Personas con acceso a Gestión.** Se agregan cuentas institucionales `@hca.edu.uy` (se rechaza cualquier otro dominio). La lista se guarda en `siged-config.json`, así que aplica en todos los dispositivos. Los administradores principales no se pueden quitar.

- **Descargar fotos en ZIP.** Elige el nivel, pulsa "Cargar grupos", marca los grupos y las versiones (alta resolución, peso reducido, SIGED). El ZIP se arma con lo que hay en Drive para el año lectivo; los archivos se nombran solo con la cédula (`12345678.jpg`), con una carpeta por versión cuando se eligen varias y, opcionalmente, una carpeta por grupo.
- **Migrar carpetas de versiones anteriores.** Pega el link de la carpeta antigua (`SIGED Fotos` de la versión anterior, con `<grupo>/`, `imagenes de estudiantes alta resolución/<grupo>/` e `imagenes por cédula/<grupo>/`, o directamente una carpeta de grupo). "Analizar" detecta los grupos y cuántas fotos de cada versión hay; "Migrar seleccionados" las copia en Drive a `<año>/<nivel>/…` conservando alta y baja resolución. La carpeta original no se toca. Si un estudiante ya tiene foto en el destino se omite, salvo que marques "Reemplazar".

## Administración

1. Conecta Drive con una cuenta administradora (lista `ADMIN_EMAILS` en `app.js`).
2. Entra en **Gestión** (menú superior). Los administradores ven ahí las secciones de configuración central y registro de actividad.
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
