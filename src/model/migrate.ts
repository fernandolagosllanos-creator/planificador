import type { Project, Task } from './types';

/**
 * Lleva un proyecto de cualquier versión anterior del esquema a la actual.
 * Se usa al abrir archivos y al recuperar el autoguardado.
 */
export function normalizeProject(project: Project): Project {
  return { ...project, tasks: project.tasks.map(normalizeTask) };
}

function normalizeTask(task: Task): Task {
  if (task.constraint) return task;
  // Esquema 1: el inicio fijado a mano equivale a "No comenzar antes del".
  const { manualStart, ...rest } = task;
  return {
    ...rest,
    constraint: manualStart ? { type: 'SNET', date: manualStart } : { type: 'ASAP', date: null },
  };
}
