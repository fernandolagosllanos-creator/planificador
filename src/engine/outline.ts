import type { Project, Task } from '../model/types';
import { computeParents, subtreeIds } from './schedule';

/**
 * Operaciones sobre el esquema (la lista de tareas con niveles): agrupar
 * tareas vinculadas bajo un resumen, desagrupar, mover filas y contraer.
 * Son funciones puras: reciben un proyecto y devuelven la lista de tareas nueva.
 */

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Tareas unidas a `id` por dependencias (en cualquier dirección y en cadena),
 * limitadas a las que comparten su mismo padre, en el orden de la tabla.
 * Incluye a la propia tarea.
 */
export function linkedComponent(project: Project, id: string): string[] {
  const parents = computeParents(project.tasks);
  const parent = parents.get(id);
  const siblings = new Set(project.tasks.filter((t) => parents.get(t.id) === parent).map((t) => t.id));
  const found = new Set<string>([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of project.dependencies) {
      const other = d.from === cur ? d.to : d.to === cur ? d.from : null;
      if (other && siblings.has(other) && !found.has(other)) {
        found.add(other);
        queue.push(other);
      }
    }
  }
  return project.tasks.filter((t) => found.has(t.id)).map((t) => t.id);
}

/**
 * Reúne las tareas indicadas (hermanas entre sí) bajo una tarea resumen nueva,
 * colocada donde estaba la primera de ellas. Devuelve las tareas y el id del resumen.
 */
export function groupTasks(project: Project, ids: string[], name = 'Grupo'): { tasks: Task[]; summaryId: string } {
  const order = project.tasks.filter((t) => ids.includes(t.id)).map((t) => t.id);
  if (order.length === 0) throw new Error('No hay tareas que agrupar');
  const parents = computeParents(project.tasks);
  const parent = parents.get(order[0]);
  if (order.some((id) => parents.get(id) !== parent)) throw new Error('Solo se pueden agrupar tareas del mismo nivel y resumen');
  const blockIds = new Set(order.flatMap((id) => subtreeIds(project.tasks, id)));
  const level = project.tasks.find((t) => t.id === order[0])!.level;
  const insertAt = project.tasks.findIndex((t) => t.id === order[0]);
  const rest = project.tasks.filter((t) => !blockIds.has(t.id));
  const block = project.tasks.filter((t) => blockIds.has(t.id)).map((t) => ({ ...t, level: t.level + 1 }));
  const summary: Task = {
    id: uid(),
    name,
    level,
    durationDays: 0,
    constraint: { type: 'ASAP', date: null },
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    notes: '',
  };
  // Las tareas eliminadas antes del punto de inserción desplazan el índice.
  const removedBefore = project.tasks.slice(0, insertAt).filter((t) => blockIds.has(t.id)).length;
  const at = insertAt - removedBefore;
  return { tasks: [...rest.slice(0, at), summary, ...block, ...rest.slice(at)], summaryId: summary.id };
}

/** Quita una tarea resumen y sube sus subtareas un nivel. */
export function ungroupTask(project: Project, id: string): Task[] {
  const ids = subtreeIds(project.tasks, id);
  if (ids.length <= 1) throw new Error('La tarea seleccionada no es un resumen con subtareas');
  const inner = new Set(ids.slice(1));
  return project.tasks.filter((t) => t.id !== id).map((t) => (inner.has(t.id) ? { ...t, level: t.level - 1 } : t));
}

/**
 * Mueve una tarea (con sus subtareas) para dejarla justo antes de `beforeId`,
 * o al final si es null. Toma el nivel de la fila ante la que se coloca.
 */
export function moveTaskBefore(project: Project, id: string, beforeId: string | null): Task[] {
  const ids = subtreeIds(project.tasks, id);
  if (beforeId && ids.includes(beforeId)) return project.tasks;
  const blockIds = new Set(ids);
  const rest = project.tasks.filter((t) => !blockIds.has(t.id));
  const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : rest.length;
  if (at < 0) return project.tasks;
  const prev = at > 0 ? rest[at - 1] : null;
  const next = at < rest.length ? rest[at] : null;
  // Nivel de destino: el de la fila siguiente; al final, el de la fila anterior sin colgarse de ella.
  const target = next ? next.level : prev ? prev.level : 0;
  const delta = target - project.tasks.find((t) => t.id === id)!.level;
  const block = project.tasks.filter((t) => blockIds.has(t.id)).map((t) => ({ ...t, level: t.level + delta }));
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** Ids visibles teniendo en cuenta los resúmenes contraídos. */
export function visibleTaskIds(tasks: Task[]): Set<string> {
  const visible = new Set<string>();
  let hideBelow: number | null = null;
  for (const t of tasks) {
    if (hideBelow !== null && t.level > hideBelow) continue;
    hideBelow = null;
    visible.add(t.id);
    if (t.collapsed) hideBelow = t.level;
  }
  return visible;
}
