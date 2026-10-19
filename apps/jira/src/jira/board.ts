/** Lógica pura del tablero simplificado: columnas por estado y elección de transiciones. */
import type { JiraIssue, JiraStatus, JiraTransition } from './client';

const CATEGORY_ORDER: Record<string, number> = { new: 0, indeterminate: 1, done: 2 };

export interface BoardColumn {
  status: JiraStatus;
  issues: JiraIssue[];
}

/**
 * Columnas del tablero: los estados del proyecto ordenados por categoría (por hacer,
 * en curso, hecho) y nombre, más cualquier estado que aparezca en las incidencias y
 * falte en la lista. Cada incidencia va a la columna de su estado (por nombre).
 */
export function buildColumns(statuses: JiraStatus[], issues: JiraIssue[]): BoardColumn[] {
  const byName = new Map<string, BoardColumn>();
  const add = (s: JiraStatus) => {
    if (!byName.has(s.name)) byName.set(s.name, { status: s, issues: [] });
  };
  statuses.forEach(add);
  for (const i of issues) add({ id: '', name: i.status, category: i.statusCategory });
  for (const i of issues) byName.get(i.status)!.issues.push(i);
  return [...byName.values()].sort(
    (a, b) =>
      (CATEGORY_ORDER[a.status.category] ?? 9) - (CATEGORY_ORDER[b.status.category] ?? 9) || a.status.name.localeCompare(b.status.name),
  );
}

/** La transición que lleva al estado pedido (por id o, si no hay, por nombre), o null. */
export function transitionTo(transitions: JiraTransition[], target: JiraStatus): JiraTransition | null {
  const byId = target.id ? transitions.find((t) => t.to.id === target.id) : undefined;
  return byId ?? transitions.find((t) => t.to.name === target.name) ?? null;
}

export interface BoardFilter {
  /** Id de tarea del planificador, '' = todas, 'linked' = solo vinculadas, 'unlinked' = solo sin vincular. */
  task: string;
  assignee: string;
  text: string;
}

export function filterIssues(issues: JiraIssue[], f: BoardFilter, taskOf: Map<string, string>): JiraIssue[] {
  const text = f.text.trim().toLowerCase();
  return issues.filter((i) => {
    const t = taskOf.get(i.key);
    if (f.task === 'linked' && !t) return false;
    if (f.task === 'unlinked' && t) return false;
    if (f.task && f.task !== 'linked' && f.task !== 'unlinked' && t !== f.task) return false;
    if (f.assignee && (i.assignee ?? '') !== f.assignee) return false;
    if (text && !i.key.toLowerCase().includes(text) && !i.summary.toLowerCase().includes(text)) return false;
    return true;
  });
}
