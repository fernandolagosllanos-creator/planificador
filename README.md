# Planificador

Aplicaciones de escritorio (Windows y Mac) para planificar proyectos con carta Gantt, pensadas para cubrir las funciones más usadas de Microsoft Project sin servidor ni licencias. Cada proyecto se guarda como un archivo `.planif` que se puede copiar a otro equipo y abrir allí.

Dos productos salen de este repositorio:

- **Planificador simple** (`apps/simple`): el planificador de siempre.
- **Planificador Jira** (`apps/jira`): el mismo planificador, conectado con Jira Cloud. Se configura una cuenta (correo + token de API, guardados en el llavero del sistema), se elige un proyecto de Jira y se vincula con el proyecto del planificador. Conecta, vincula el proyecto, lista sus incidencias y, en la vista "Alinear", enlaza cada tarea con su incidencia base (manda estado y responsable) y sus dependientes (informan avance), con sugerencias automáticas por nombre y la opción de tomar el avance desde Jira. El tablero simplificado y la escritura de estados, comentarios y fechas en Jira llegan en las etapas siguientes.

## Qué hace (versión 1)

- **Tareas y subtareas** con sangría, numeración EDT automática y tareas resumen calculadas.
- **Duraciones** en días laborales, **hitos** (duración 0) y **dependencias** FC, CC, FF y CF con adelanto/retraso, escritas como en Project (`3FC+2d;5CC`) o dibujadas arrastrando en la Gantt.
- **Programación automática** con las 8 restricciones de Project (lo antes posible, no comenzar antes del, debe finalizar el…), ruta crítica, holgura total y fechas tardías.
- **Calendario laboral** editable (días laborables y feriados) con los feriados de Chile 2026–2028 precargados.
- **Gantt interactiva**: arrastrar barras para mover o alargar, vincular tareas arrastrando, zoom por días/semanas/meses, línea de hoy.
- **Recursos**: hoja de recursos, asignación a tareas (panel o columna `Recursos`), vista de carga semanal con sobreasignación.
- **Línea base y avance**: guardar línea base, variaciones, fecha de estado, línea de progreso, % completado y fechas reales.
- **Intercambio**: importar y exportar **XML de Microsoft Project** (MSPDI), exportar la tabla a **Excel (.xlsx)** y **CSV**, e **informe para imprimir o PDF**.
- **Archivo**: nuevo, abrir, guardar, guardar como, deshacer/rehacer, autoguardado en el navegador.
- **Actualizaciones automáticas** desde GitHub Releases.

## Instalación

Descarga el instalador desde la pestaña [Releases](../../releases): los de Planificador simple se llaman `simple-vX.Y.Z` y los de Planificador Jira `jira-vX.Y.Z` (marcados como pre-release). En cada uno:

- Windows: `..._x.y.z_x64-setup.exe`.
- Mac con chip Apple (M1 en adelante): `..._x.y.z_aarch64.dmg`.
- Mac con Intel: `..._x.y.z_x64.dmg`.

Las dos apps pueden convivir en el mismo computador.

Las apps no están firmadas con certificado de desarrollador: en Mac la primera vez hay que abrirlas con clic derecho → Abrir; en Windows, "Más información → Ejecutar de todas formas". Las versiones siguientes se instalan solas desde la aplicación (barra de estado → *buscar actualizaciones*, o al iniciar).

## Tecnología

- [Tauri 2](https://tauri.app) (Rust) para la aplicación de escritorio.
- React 19 + TypeScript + Vite para la interfaz; estado con Zustand.
- Motor de programación propio en `packages/core/src/engine/` con pruebas en Vitest.
- Gantt dibujada en SVG, sin componentes con licencia.

## Desarrollo

Requisitos: Node 22+ y, para la versión de escritorio, Rust (`rustup`) con los [prerequisitos de Tauri](https://tauri.app/start/prerequisites/) de tu sistema.

```bash
npm install
npm run dev          # interfaz en el navegador (http://localhost:5173)
npm test             # pruebas del motor y de los formatos (packages/core)
npm run lint
npm run typecheck
npm run tauri dev    # aplicación de escritorio en modo desarrollo
npm run tauri build  # instalador para el sistema actual

npm run dev:jira         # Planificador Jira en el navegador (http://localhost:5174; sin conexión a Jira)
npm run tauri:jira dev   # Planificador Jira de escritorio (con conexión a Jira)
```

Los comandos `dev`, `tauri` y `typecheck` de la raíz operan sobre `apps/simple`; `dev:jira` y `tauri:jira` sobre `apps/jira`; `build` y `typecheck` compilan las dos. Para trabajar dentro de un paquete concreto: `npm run <script> -w apps/jira` o `-w packages/core`.

La conexión con Jira solo existe en la aplicación de escritorio: las llamadas a la API y el token viven en el lado Rust (`apps/jira/src-tauri/src/lib.rs`), y el token se guarda en el Llavero (Mac) o el Administrador de credenciales (Windows). En el navegador la app muestra el planificador sin Jira.

En el navegador, "Guardar" descarga el archivo `.planif` y "Abrir" lo sube; en la aplicación de escritorio se usan los diálogos nativos.

Para compilar un instalador local con paquetes de actualización firmados hace falta la clave privada:

```bash
TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/planificador.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run tauri build
```

## Publicar una versión

1. Sube el número de versión de la app en su `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml` (los tres iguales).
2. Confirma el cambio y crea la etiqueta con el prefijo del producto:

```bash
git tag simple-v0.3.0        # Planificador simple
git tag jira-v0.1.0          # Planificador Jira
git push origin main simple-v0.3.0
```

GitHub Actions (`.github/workflows/build.yml`) corre las pruebas, compila los instaladores de Windows y Mac (Apple Silicon e Intel) de la app de la etiqueta y publica un *Release* con los instaladores, los paquetes de actualización firmados y el manifiesto `latest.json` que consultan las apps instaladas. Planificador simple lee `releases/latest/download/latest.json`; Planificador Jira, cuyos releases son pre-release para no desplazar a ese "latest", lee `updates/jira/latest.json` de la rama `main`, que el flujo actualiza solo al publicar una etiqueta `jira-v*`. Los secretos `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` del repositorio deben corresponder a la clave pública de `tauri.conf.json`; si se pierde la clave privada, las apps ya instaladas no aceptarán más actualizaciones.

## Formato del archivo `.planif`

Un ZIP con `project.json`: el proyecto (tareas, dependencias, calendario, recursos, asignaciones, línea base, fecha de estado y, en Planificador Jira, la sección `jira` con el proyecto vinculado y los vínculos tarea–incidencia, nunca credenciales) más las fechas calculadas, para que otras herramientas puedan leerlo. `schemaVersion` permite abrir archivos de versiones anteriores con migración automática (`packages/core/src/model/migrate.ts`).

## Estructura

El repositorio es un monorepo (npm workspaces): un núcleo compartido y una aplicación por producto. Las dos apps usan el mismo núcleo; `AppShell` y `Toolbar` aceptan vistas, menús y elementos de la barra de estado adicionales, que es como Planificador Jira añade lo suyo.

```
packages/core/src/          Núcleo compartido (@planificador/core)
  model/types.ts            Tipos del proyecto
  model/migrate.ts          Migración de archivos antiguos
  engine/calendar.ts        Calendario laboral y aritmética de fechas
  engine/schedule.ts        Motor: dependencias, restricciones, resumen, ruta crítica
  engine/resources.ts       Carga de recursos y sobreasignación
  engine/tracking.ts        Línea base, variaciones y línea de progreso
  engine/*.test.ts          Pruebas
  file/planif.ts            Archivo .planif y diálogos de abrir/guardar
  file/mspdi.ts             XML de Microsoft Project
  file/tabular.ts           Excel y CSV
  file/report.ts            Informe imprimible
  store/project.ts          Estado, deshacer/rehacer, proyecto de ejemplo
  components/               Pantalla principal (AppShell), barra, tabla, Gantt, detalle, recursos, carga, calendario
  updater.ts                Actualizaciones automáticas
  appInfo.ts                Nombre y versión de la app que usa el núcleo
  index.css                 Estilos compartidos
apps/simple/                Planificador simple
  src/App.tsx               Usa AppShell tal cual
  src-tauri/                Aplicación Tauri (Rust): comandos, permisos, iconos
apps/jira/                  Planificador Jira
  src/App.tsx               AppShell + menú Jira, vista Jira y estado de conexión
  src/jira/client.ts        Cliente de la API de Jira (vía el comando Rust jira_request)
  src/jira/store.ts         Estado de la conexión (Zustand)
  src/jira/ConnectDialog.tsx  Asistente: cuenta → proyecto → campos de fecha
  src/jira/JiraView.tsx     Incidencias del proyecto vinculado
  src/jira/AlignView.tsx    Vista Alinear: tarea ↔ incidencia base y dependientes
  src/jira/links.ts         Lógica de los vínculos y sugerencias por nombre (con pruebas)
  src-tauri/src/lib.rs      Credenciales en el llavero y llamadas a Jira
updates/jira/latest.json    Manifiesto de actualización de Planificador Jira (lo escribe el flujo)
.github/workflows/          Compilación de instaladores y publicación
```
