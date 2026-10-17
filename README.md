# Planificador

Aplicación de escritorio (Windows y Mac) para planificar proyectos con carta Gantt, pensada para cubrir las funciones más usadas de Microsoft Project sin servidor ni licencias. Cada proyecto se guarda como un archivo `.planif` que se puede copiar a otro equipo y abrir allí.

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

Descarga el instalador desde la pestaña [Releases](../../releases/latest):

- Windows: `Planificador_x.y.z_x64-setup.exe`.
- Mac con chip Apple (M1 en adelante): `Planificador_x.y.z_aarch64.dmg`.
- Mac con Intel: `Planificador_x.y.z_x64.dmg`.

Las apps no están firmadas con certificado de desarrollador: en Mac la primera vez hay que abrirlas con clic derecho → Abrir; en Windows, "Más información → Ejecutar de todas formas". Las versiones siguientes se instalan solas desde la aplicación (barra de estado → *buscar actualizaciones*, o al iniciar).

## Tecnología

- [Tauri 2](https://tauri.app) (Rust) para la aplicación de escritorio.
- React 19 + TypeScript + Vite para la interfaz; estado con Zustand.
- Motor de programación propio en `src/engine/` con pruebas en Vitest.
- Gantt dibujada en SVG, sin componentes con licencia.

## Desarrollo

Requisitos: Node 22+ y, para la versión de escritorio, Rust (`rustup`) con los [prerequisitos de Tauri](https://tauri.app/start/prerequisites/) de tu sistema.

```bash
npm install
npm run dev          # interfaz en el navegador (http://localhost:5173)
npm test             # pruebas del motor y de los formatos
npm run lint
npm run tauri dev    # aplicación de escritorio en modo desarrollo
npm run tauri build  # instalador para el sistema actual
```

En el navegador, "Guardar" descarga el archivo `.planif` y "Abrir" lo sube; en la aplicación de escritorio se usan los diálogos nativos.

Para compilar un instalador local con paquetes de actualización firmados hace falta la clave privada:

```bash
TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/planificador.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run tauri build
```

## Publicar una versión

1. Sube el número de versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml` (los tres iguales).
2. Confirma el cambio y crea la etiqueta:

```bash
git tag v0.2.0
git push origin main v0.2.0
```

GitHub Actions (`.github/workflows/build.yml`) corre las pruebas, compila los instaladores de Windows y Mac (Apple Silicon e Intel) y publica un *Release* con los instaladores, los paquetes de actualización firmados y el manifiesto `latest.json` que consultan las apps instaladas. Los secretos `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` del repositorio deben corresponder a la clave pública de `tauri.conf.json`; si se pierde la clave privada, las apps ya instaladas no aceptarán más actualizaciones.

## Formato del archivo `.planif`

Un ZIP con `project.json`: el proyecto (tareas, dependencias, calendario, recursos, asignaciones, línea base, fecha de estado) más las fechas calculadas, para que otras herramientas puedan leerlo. `schemaVersion` permite abrir archivos de versiones anteriores con migración automática (`src/model/migrate.ts`).

## Estructura

```
src/
  model/types.ts          Tipos del proyecto
  model/migrate.ts        Migración de archivos antiguos
  engine/calendar.ts      Calendario laboral y aritmética de fechas
  engine/schedule.ts      Motor: dependencias, restricciones, resumen, ruta crítica
  engine/resources.ts     Carga de recursos y sobreasignación
  engine/tracking.ts      Línea base, variaciones y línea de progreso
  engine/*.test.ts        Pruebas
  file/planif.ts          Archivo .planif y diálogos de abrir/guardar
  file/mspdi.ts           XML de Microsoft Project
  file/tabular.ts         Excel y CSV
  file/report.ts          Informe imprimible
  store/project.ts        Estado, deshacer/rehacer, proyecto de ejemplo
  components/             Tabla, Gantt, detalle, recursos, carga, calendario, barra
  updater.ts              Actualizaciones automáticas
src-tauri/                Aplicación Tauri (Rust): comandos, permisos, iconos
.github/workflows/        Compilación de instaladores y publicación
```
