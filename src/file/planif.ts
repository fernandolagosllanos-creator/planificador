import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from '../model/types';
import { PLANIF_FORMAT, PLANIF_SCHEMA_VERSION } from '../model/types';
import { schedule } from '../engine/schedule';

export const APP_VERSION = '0.1.0';
export const FILE_EXTENSION = 'planif';

interface PlanifDocument {
  format: typeof PLANIF_FORMAT;
  schemaVersion: number;
  app: { name: string; version: string };
  savedAt: string;
  project: Project;
  /** Fechas calculadas, para que otras herramientas puedan leer el archivo sin el motor. */
  computed: { id: string; start: string; finish: string; percentComplete: number }[];
}

export function serializeProject(project: Project): Uint8Array {
  const result = schedule(project);
  const doc: PlanifDocument = {
    format: PLANIF_FORMAT,
    schemaVersion: PLANIF_SCHEMA_VERSION,
    app: { name: 'Planificador', version: APP_VERSION },
    savedAt: new Date().toISOString(),
    project,
    computed: result.order.map((t) => ({ id: t.id, start: t.start, finish: t.finish, percentComplete: t.percentComplete })),
  };
  return zipSync({ 'project.json': strToU8(JSON.stringify(doc, null, 2)) }, { level: 6 });
}

export function deserializeProject(bytes: Uint8Array): Project {
  let text: string;
  try {
    const files = unzipSync(bytes);
    const entry = files['project.json'];
    if (!entry) throw new Error('El archivo no contiene project.json');
    text = strFromU8(entry);
  } catch {
    // Permitir también un JSON sin comprimir.
    text = new TextDecoder().decode(bytes);
  }
  const doc = JSON.parse(text) as Partial<PlanifDocument>;
  if (doc.format !== PLANIF_FORMAT || !doc.project) throw new Error('No es un archivo de Planificador válido');
  if ((doc.schemaVersion ?? 0) > PLANIF_SCHEMA_VERSION)
    throw new Error('Este archivo fue creado con una versión más nueva de Planificador. Actualiza la aplicación.');
  return migrate(doc.project, doc.schemaVersion ?? 0);
}

function migrate(project: Project, _fromVersion: number): Project {
  // Aquí irán las migraciones cuando cambie el esquema.
  return project;
}

// ---------------------------------------------------------------------------
// Acceso a archivos: Tauri (escritorio) o navegador (desarrollo / fallback).
// ---------------------------------------------------------------------------

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface OpenResult {
  project: Project;
  path: string | null;
}

export async function openProjectFile(): Promise<OpenResult | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Proyecto Planificador', extensions: [FILE_EXTENSION] }],
    });
    if (!path) return null;
    const bytes = await readFile(path as string);
    return { project: deserializeProject(bytes), path: path as string };
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${FILE_EXTENSION},application/json`;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        resolve({ project: deserializeProject(bytes), path: null });
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

/** Guarda el proyecto. Devuelve la ruta usada, o null si el usuario canceló. */
export async function saveProjectFile(project: Project, currentPath: string | null, forceDialog = false): Promise<string | null> {
  const bytes = serializeProject(project);
  const suggested = `${sanitize(project.name) || 'proyecto'}.${FILE_EXTENSION}`;
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    let path = currentPath;
    if (!path || forceDialog) {
      path = await save({
        defaultPath: suggested,
        filters: [{ name: 'Proyecto Planificador', extensions: [FILE_EXTENSION] }],
      });
      if (!path) return null;
      if (!path.toLowerCase().endsWith(`.${FILE_EXTENSION}`)) path += `.${FILE_EXTENSION}`;
    }
    await writeFile(path, bytes);
    return path;
  }
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggested;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggested;
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim();
}

const AUTOSAVE_KEY = 'planificador.autosave';

export function autosave(project: Project): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch {
    /* sin almacenamiento disponible */
  }
}

export function loadAutosave(): Project | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as Project) : null;
  } catch {
    return null;
  }
}
