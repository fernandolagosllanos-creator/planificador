# Planificador

Aplicación de escritorio (Windows y Mac) para planificar proyectos con carta Gantt, pensada para cubrir las funciones más usadas de Microsoft Project sin servidor ni licencias. Cada proyecto se guarda como un archivo `.planif` que se puede copiar a otro equipo y abrir allí.

## Estado: prototipo (etapa 0)

Incluye:

- Tabla de tareas editable (doble clic en una celda): nombre, duración en días laborales, comienzo, predecesoras y % completado.
- Subtareas con sangría, numeración EDT automática y tareas resumen calculadas.
- Dependencias FC, CC, FF y CF con adelanto/retraso, escritas como en Project: `3FC+2d;5CC`.
- Hitos (duración 0).
- Calendario laboral lunes a viernes con feriados de Chile 2026 precargados.
- Ruta crítica resaltada en rojo y línea de "hoy".
- Zoom por días, semanas y meses.
- Deshacer / rehacer.
- Guardar y abrir archivos `.planif` (ZIP con `project.json`).

Pendiente para las etapas siguientes: arrastrar barras en la Gantt, recursos, línea base, exportar a MS Project XML / Excel / PDF.

## Tecnología

- [Tauri 2](https://tauri.app) (Rust) para la aplicación de escritorio.
- React 19 + TypeScript + Vite para la interfaz.
- Motor de programación propio en `src/engine/` con pruebas en Vitest.

## Desarrollo

Requisitos: Node 22 y, para la versión de escritorio, Rust (`rustup`) con los [prerequisitos de Tauri](https://tauri.app/start/prerequisites/) de tu sistema.

```bash
npm install
npm run dev          # interfaz en el navegador (http://localhost:5173)
npm test             # pruebas del motor
npm run tauri dev    # aplicación de escritorio en modo desarrollo
npm run tauri build  # instalador para el sistema actual
```

En el navegador, "Guardar" descarga el archivo `.planif` y "Abrir" lo sube; en la aplicación de escritorio se usan los diálogos nativos.

## Instaladores

GitHub Actions compila los instaladores de Windows (`.msi`, `-setup.exe`) y Mac (`.dmg`, Apple Silicon e Intel). Para publicar una versión:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Los instaladores quedan en la pestaña *Releases* del repositorio. Las apps no están firmadas: en Mac la primera vez hay que abrirlas con clic derecho → Abrir; en Windows, "Más información → Ejecutar de todas formas".

## Estructura

```
src/
  model/types.ts        Tipos del proyecto (tareas, dependencias, calendario)
  engine/calendar.ts    Calendario laboral y aritmética de fechas
  engine/schedule.ts    Motor: dependencias, resumen, ruta crítica, predecesoras
  engine/*.test.ts      Pruebas del motor
  store/project.ts      Estado de la aplicación, deshacer/rehacer, proyecto de ejemplo
  file/planif.ts        Formato .planif y acceso a archivos (Tauri o navegador)
  components/           Tabla, Gantt, barra de herramientas
src-tauri/              Aplicación Tauri (Rust), permisos, configuración de empaquetado
.github/workflows/      Compilación automática de instaladores
```
