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
- Sección **Editar fotos** (menú superior, disponible para todos sin Drive ni base de datos): recorta una o varias imágenes sueltas con el formato y crop del sitio y las descarga en las tres versiones. Ver [Editar fotos sueltas](#editar-fotos-sueltas).
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

## Editar fotos sueltas

La pestaña **Editar fotos** sirve para preparar fotos individuales sin cargar la base de estudiantes, sin seleccionar grupo y sin conectar Drive. Es útil para fotos que llegan por otros medios (WhatsApp, correo, escáner) o para rehacer el encuadre de una foto puntual.

1. Arrastra una o varias imágenes al recuadro (o haz clic para elegirlas).
2. Para cada foto ajusta el **encuadre cuadrado**: arrastra para mover, usa el zoom (deslizador, rueda del mouse o pinza en pantallas táctiles) y rota de a 90° si hace falta. Las guías de tercios y la vista previa de 100×100 muestran exactamente lo que se guardará.
3. Opcionalmente escribe el **documento** y el **nombre**: así los archivos se nombran igual que los que genera la app (`12345678.png`, `Nombre_Apellido_12345678.jpg`, `12345678.jpg`). Si el archivo original ya se llama `12345678.jpg` o `Nombre_Apellido_12345678.jpg`, los datos se completan solos. Sin documento se usa el nombre del archivo original.
4. Marca las versiones a generar (SIGED 100×100 PNG, alta resolución 1080×1080 JPG, peso reducido 600×600 JPG) y descarga:
   - **Descargar esta foto**: un archivo si hay una sola versión marcada, o un ZIP con una carpeta por versión.
   - **Descargar todas (ZIP)**: todas las fotos cargadas, con la misma estructura de carpetas que el ZIP de grupo (`SIGED/`, `imagenes de estudiantes alta resolución/`, `imagenes por cédula/`).

Nada se sube a Drive ni a internet: las fotos se procesan y se descargan en el propio dispositivo.

## Gestión

El menú superior tiene tres secciones: **Tomar fotos**, **Editar fotos** y **Gestión**. La pestaña Gestión solo aparece para administradores con Drive conectado: los administradores principales (lista `ADMIN_EMAILS` en `app.js`) y las personas agregadas desde la propia sección.

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
