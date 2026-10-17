/**
 * Nombre y versión de la aplicación que usa el núcleo. Cada app (Planificador simple,
 * Planificador Jira) los fija al arrancar con `setAppInfo`; el núcleo los escribe en el
 * `.planif` y los muestra en la barra de estado.
 */
let info = { name: 'Planificador', version: '0.0.0' };

export function setAppInfo(next: { name: string; version: string }): void {
  info = { ...next };
}

export function appName(): string {
  return info.name;
}

export function appVersion(): string {
  return info.version;
}
