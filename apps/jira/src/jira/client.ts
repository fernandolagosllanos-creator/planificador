/**
 * Cliente de Jira Cloud. Todas las llamadas pasan por el lado Rust (comando `jira_request`),
 * que añade las credenciales guardadas en el llavero del sistema. En el navegador (desarrollo
 * sin Tauri) no hay conexión posible.
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@planificador/core';

export interface JiraAccount {
  site: string;
  email: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  /** `software`, `business` o `service_desk`. */
  projectTypeKey?: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
}

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type?: string; custom?: string };
}

export interface JiraIssue {
  key: string;
  summary: string;
  type: string;
  status: string;
  statusCategory: 'new' | 'indeterminate' | 'done' | string;
  assignee: string | null;
  dueDate: string | null;
  startDate: string | null;
}

interface JiraResponse {
  status: number;
  body: unknown;
}

const NOT_DESKTOP = 'La conexión con Jira solo está disponible en la aplicación de escritorio.';

function requireDesktop(): void {
  if (!isTauri()) throw new Error(NOT_DESKTOP);
}

/** Extrae un mensaje legible de una respuesta de error de Jira. */
function errorMessage(res: JiraResponse): string {
  const b = res.body as { errorMessages?: string[]; errors?: Record<string, string>; message?: string } | null;
  const parts = [...(b?.errorMessages ?? []), ...Object.values(b?.errors ?? {})];
  if (b?.message) parts.push(b.message);
  return parts.length ? `${parts.join(' ')} (${res.status})` : `Jira respondió con el código ${res.status}.`;
}

export async function request<T = unknown>(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<T> {
  requireDesktop();
  const res = await invoke<JiraResponse>('jira_request', {
    method,
    path,
    query: query ? Object.entries(query) : null,
    body: body ?? null,
  });
  if (res.status === 401) throw new Error('Jira rechazó las credenciales guardadas; vuelve a conectar.');
  if (res.status < 200 || res.status >= 300) throw new Error(errorMessage(res));
  return res.body as T;
}

/** Prueba las credenciales y, si funcionan, las guarda en el llavero. */
export async function connect(site: string, email: string, token: string): Promise<JiraUser> {
  requireDesktop();
  return invoke<JiraUser>('jira_connect', { site, email, token });
}

export async function storedAccount(): Promise<JiraAccount | null> {
  if (!isTauri()) return null;
  return invoke<JiraAccount | null>('jira_stored_account');
}

export async function forget(): Promise<void> {
  if (!isTauri()) return;
  await invoke('jira_forget');
}

export const myself = () => request<JiraUser>('GET', '/rest/api/3/myself');

export async function listProjects(): Promise<JiraProject[]> {
  const out: JiraProject[] = [];
  let startAt = 0;
  for (;;) {
    const page = await request<{ values: JiraProject[]; isLast?: boolean; total?: number }>('GET', '/rest/api/3/project/search', {
      startAt: String(startAt),
      maxResults: '100',
      orderBy: 'name',
    });
    out.push(...page.values.map((p) => ({ id: p.id, key: p.key, name: p.name, projectTypeKey: p.projectTypeKey })));
    if (page.isLast !== false || page.values.length === 0) break;
    startAt += page.values.length;
    if (startAt > 2000) break;
  }
  return out;
}

export async function listBoards(projectKey: string): Promise<JiraBoard[]> {
  try {
    const page = await request<{ values: JiraBoard[] }>('GET', '/rest/agile/1.0/board', { projectKeyOrId: projectKey, maxResults: '50' });
    return page.values.map((b) => ({ id: b.id, name: b.name, type: b.type }));
  } catch {
    // Sin Jira Software (proyectos business) no hay tableros: no es un error.
    return [];
  }
}

/** Campos de tipo fecha del sitio, candidatos a "fecha de inicio planificada". */
export async function listDateFields(): Promise<JiraField[]> {
  const fields = await request<JiraField[]>('GET', '/rest/api/3/field');
  return fields
    .filter((f) => f.schema?.type === 'date')
    .map((f) => ({ id: f.id, name: f.name, custom: f.custom, schema: f.schema }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Entre los campos de fecha, el que más parece "fecha de inicio" (Start date / Fecha de inicio). */
export function guessStartField(fields: JiraField[]): string | null {
  const byName = (re: RegExp) => fields.find((f) => re.test(f.name));
  return (byName(/^(start date|fecha de inicio)$/i) ?? byName(/start|inicio/i))?.id ?? null;
}

export interface IssueQuery {
  projectKey: string;
  startDateField: string | null;
  dueDateField: string;
}

/** Incidencias del proyecto, las más recientes primero (hasta 200). */
export async function listIssues(q: IssueQuery): Promise<JiraIssue[]> {
  const fields = ['summary', 'status', 'issuetype', 'assignee', q.dueDateField, ...(q.startDateField ? [q.startDateField] : [])];
  const out: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await request<{ issues: RawIssue[]; nextPageToken?: string }>('GET', '/rest/api/3/search/jql', {
      jql: `project = "${q.projectKey}" ORDER BY created DESC`,
      maxResults: '100',
      fields: fields.join(','),
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    out.push(...page.issues.map((i) => toIssue(i, q)));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && out.length < 200);
  return out;
}

interface RawIssue {
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    assignee?: { displayName?: string } | null;
  };
}

function toIssue(raw: RawIssue, q: IssueQuery): JiraIssue {
  const f = raw.fields;
  const date = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : null);
  return {
    key: raw.key,
    summary: f.summary ?? '',
    type: f.issuetype?.name ?? '',
    status: f.status?.name ?? '',
    statusCategory: f.status?.statusCategory?.key ?? '',
    assignee: f.assignee?.displayName ?? null,
    dueDate: date(f[q.dueDateField]),
    startDate: q.startDateField ? date(f[q.startDateField]) : null,
  };
}
