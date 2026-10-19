/**
 * Lógica pura de los vínculos tarea ↔ incidencias de Jira (sin React ni red).
 * Cada tarea puede tener una incidencia base (manda estado y responsable) y varias
 * dependientes (informan avance). Una incidencia solo puede estar vinculada a una tarea.
 */
import type { JiraLink, JiraTaskLink, Task } from '@planificador/core';
import type { JiraIssue } from './client';

export type IssueIndex = Map<string, JiraIssue>;

export function indexIssues(issues: JiraIssue[]): IssueIndex {
  return new Map(issues.map((i) => [i.key, i]));
}

export function linkOf(link: JiraLink | null | undefined, taskId: string): JiraTaskLink | undefined {
  return link?.links.find((l) => l.taskId === taskId);
}

/** Clave de incidencia → id de la tarea que la usa (como base o dependiente). */
export function usedKeys(link: JiraLink | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of link?.links ?? []) {
    m.set(l.base, l.taskId);
    for (const d of l.dependents) m.set(d, l.taskId);
  }
  return m;
}

/** Quita la incidencia de cualquier tarea donde esté (base o dependiente). */
function release(links: JiraTaskLink[], key: string): JiraTaskLink[] {
  return links
    .map((l) => (l.base === key ? { ...l, base: '' } : { ...l, dependents: l.dependents.filter((d) => d !== key) }))
    .filter((l) => l.base || l.dependents.length);
}

function upsert(links: JiraTaskLink[], taskId: string, fn: (l: JiraTaskLink) => JiraTaskLink): JiraTaskLink[] {
  const cur = links.find((l) => l.taskId === taskId) ?? { taskId, base: '', dependents: [] };
  const next = fn(cur);
  const rest = links.filter((l) => l.taskId !== taskId);
  return next.base || next.dependents.length ? [...rest, next] : rest;
}

/** Fija la incidencia base de la tarea (la antigua base queda libre). */
export function setBase(links: JiraTaskLink[], taskId: string, key: string): JiraTaskLink[] {
  return upsert(release(links, key), taskId, (l) => ({ ...l, base: key, dependents: l.dependents.filter((d) => d !== key) }));
}

export function addDependent(links: JiraTaskLink[], taskId: string, key: string): JiraTaskLink[] {
  // La base de la tarea no puede ser además su dependiente.
  if (links.some((l) => l.taskId === taskId && l.base === key)) return links;
  return upsert(release(links, key), taskId, (l) => ({ ...l, dependents: [...l.dependents, key] }));
}

export function removeIssue(links: JiraTaskLink[], key: string): JiraTaskLink[] {
  return release(links, key);
}

export function unlinkTask(links: JiraTaskLink[], taskId: string): JiraTaskLink[] {
  return links.filter((l) => l.taskId !== taskId);
}

/** Estado de una tarea respecto de Jira, calculado a partir de las incidencias cargadas. */
export interface TaskJiraStatus {
  base: JiraIssue | null;
  /** Clave de la base cuando no aparece entre las incidencias del proyecto (borrada o movida). */
  missingBase: string | null;
  dependents: JiraIssue[];
  missingDependents: string[];
  doneDependents: number;
  /** Avance sugerido por Jira (0–100), o null si no hay con qué calcularlo. */
  progress: number | null;
}

export function taskStatus(link: JiraLink | null | undefined, taskId: string, issues: IssueIndex): TaskJiraStatus | null {
  const l = linkOf(link, taskId);
  if (!l) return null;
  const base = l.base ? (issues.get(l.base) ?? null) : null;
  const dependents = l.dependents.map((k) => issues.get(k)).filter((i): i is JiraIssue => !!i);
  const doneDependents = dependents.filter((i) => i.statusCategory === 'done').length;
  let progress: number | null = null;
  if (base?.statusCategory === 'done') progress = 100;
  else if (dependents.length) progress = Math.round((doneDependents / dependents.length) * 100);
  else if (base) progress = base.statusCategory === 'indeterminate' ? null : 0;
  return {
    base,
    missingBase: l.base && !base ? l.base : null,
    dependents,
    missingDependents: l.dependents.filter((k) => !issues.has(k)),
    doneDependents,
    progress,
  };
}

/** Para una tarea resumen: incidencias vinculadas en sus descendientes y cuántas están hechas. */
export function summaryStatus(tasks: Task[], index: number, link: JiraLink | null | undefined, issues: IssueIndex): { done: number; total: number } {
  const level = tasks[index].level;
  let done = 0;
  let total = 0;
  for (let i = index + 1; i < tasks.length && tasks[i].level > level; i++) {
    const l = linkOf(link, tasks[i].id);
    if (!l) continue;
    for (const k of [l.base, ...l.dependents].filter(Boolean)) {
      total++;
      if (issues.get(k)?.statusCategory === 'done') done++;
    }
  }
  return { done, total };
}

// ---------------------------------------------------------------------------
// Sugerencias automáticas por parecido del nombre.
// ---------------------------------------------------------------------------

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'u', 'a', 'en', 'con', 'por', 'para', 'al', 'un', 'una', 'the', 'of', 'and', 'to', 'for']);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t)));
}

/** Parecido entre 0 y 1 entre el nombre de una tarea y el resumen de una incidencia. */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if ((na.length >= 8 && nb.includes(na)) || (nb.length >= 8 && na.includes(nb))) return 0.9;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}

export interface Suggestion {
  taskId: string;
  key: string;
  score: number;
}

/**
 * Propone una incidencia base para cada tarea hoja sin vincular, con la incidencia
 * más parecida que no esté usada. Solo parecidos claros (≥ 0.6).
 */
export function suggestLinks(tasks: Task[], issues: JiraIssue[], link: JiraLink | null | undefined, minScore = 0.6): Suggestion[] {
  const used = usedKeys(link);
  const leaf = new Set(tasks.filter((t, i) => !(tasks[i + 1] && tasks[i + 1].level > t.level)).map((t) => t.id));
  const candidates: Suggestion[] = [];
  for (const t of tasks) {
    if (!leaf.has(t.id) || linkOf(link, t.id)) continue;
    for (const i of issues) {
      if (used.has(i.key)) continue;
      const score = similarity(t.name, i.summary);
      if (score >= minScore) candidates.push({ taskId: t.id, key: i.key, score });
    }
  }
  // Mejor puntaje primero; cada tarea y cada incidencia se usan una sola vez.
  candidates.sort((a, b) => b.score - a.score);
  const takenTask = new Set<string>();
  const takenKey = new Set<string>();
  const out: Suggestion[] = [];
  for (const c of candidates) {
    if (takenTask.has(c.taskId) || takenKey.has(c.key)) continue;
    takenTask.add(c.taskId);
    takenKey.add(c.key);
    out.push(c);
  }
  return out;
}
