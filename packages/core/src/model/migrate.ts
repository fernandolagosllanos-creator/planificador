import type { Project, Task } from './types';

/**
 * Lleva un proyecto de cualquier versión anterior del esquema a la actual.
 * Se usa al abrir archivos y al recuperar el autoguardado.
 */
export function normalizeProject(project: Project): Project {
  return {
    ...project,
    tasks: project.tasks.map(normalizeTask),
    // Esquema 3: recursos y asignaciones.
    resources: project.resources ?? [],
    assignments: project.assignments ?? [],
    // Esquema 4: línea base, fecha de estado y fechas reales.
    statusDate: project.statusDate ?? null,
    baseline: project.baseline ?? null,
  };
}

function normalizeTask(task: Task): Task {
  // Esquema 1: el inicio fijado a mano equivale a "No comenzar antes del".
  const { manualStart, ...rest } = task;
  return {
    ...rest,
    constraint: task.constraint ?? (manualStart ? { type: 'SNET', date: manualStart } : { type: 'ASAP', date: null }),
    actualStart: task.actualStart ?? null,
    actualFinish: task.actualFinish ?? null,
  };
}
