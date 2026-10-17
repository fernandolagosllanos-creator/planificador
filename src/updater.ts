import { isTauri } from './file/planif';

/**
 * Actualizaciones automáticas: consulta el manifiesto publicado en GitHub
 * Releases y, si hay una versión nueva, la descarga, la instala y reinicia.
 * Solo funciona en la aplicación de escritorio (en el navegador no hace nada).
 */

export interface UpdateCheck {
  available: boolean;
  version?: string;
  notes?: string;
  install?: (onProgress: (percent: number | null) => void) => Promise<void>;
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  if (!isTauri()) return { available: false };
  const { check } = await import('@tauri-apps/plugin-updater');
  const { relaunch } = await import('@tauri-apps/plugin-process');
  const update = await check();
  if (!update) return { available: false };
  return {
    available: true,
    version: update.version,
    notes: update.body ?? undefined,
    install: async (onProgress) => {
      let total: number | null = null;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? null;
        else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          onProgress(total ? Math.round((received / total) * 100) : null);
        } else if (event.event === 'Finished') onProgress(100);
      });
      await relaunch();
    },
  };
}

/**
 * Comprueba al iniciar y pregunta al usuario. `silent` oculta el mensaje de
 * "ya tienes la última versión" (para la comprobación automática).
 */
export async function promptForUpdate(silent: boolean, report: (msg: string | null) => void): Promise<void> {
  try {
    const u = await checkForUpdates();
    if (!u.available || !u.install) {
      if (!silent) report('Ya tienes la versión más reciente de Planificador.');
      return;
    }
    const ok = window.confirm(`Hay una versión nueva de Planificador (${u.version}). ¿Descargarla e instalarla ahora? La aplicación se reiniciará.`);
    if (!ok) return;
    report('Descargando la actualización…');
    await u.install((pct) => report(pct === null ? 'Descargando la actualización…' : `Descargando la actualización… ${pct}%`));
  } catch (e) {
    if (!silent) report(`No se pudo buscar actualizaciones: ${(e as Error).message}`);
  }
}
