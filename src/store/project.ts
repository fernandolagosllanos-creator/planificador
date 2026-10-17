import { create } from 'zustand';
import type { Calendar, Dependency, ISODate, Project, Resource, Task, TaskConstraint } from '../model/types';
import { initialsOf, parseResourceNames } from '../engine/resources';
import { defaultCalendar, today } from '../engine/calendar';
import { linkError, parsePredecessors, schedule, subtreeIds } from '../engine/schedule';
import { takeBaseline } from '../engine/tracking';

export type Zoom = 'day' | 'week' | 'month';
export type View = 'gantt' | 'resources' | 'load';

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newTask(partial: Partial<Task> = {}): Task {
  return {
    id: uid(),
    name: 'Nueva tarea',
    level: 0,
    durationDays: 1,
    constraint: { type: 'ASAP', date: null },
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    notes: '',
    ...partial,
  };
}

export function emptyProject(name = 'Proyecto sin título'): Project {
  return {
    id: uid(),
    name,
    start: today(),
    statusDate: null,
    baseline: null,
    calendarId: 'cal-std',
    calendars: [defaultCalendar()],
    tasks: [newTask({ name: 'Tarea 1' })],
    dependencies: [],
    resources: [],
    assignments: [],
  };
}

export function newResource(partial: Partial<Resource> = {}): Resource {
  const name = partial.name ?? 'Nuevo recurso';
  return { id: uid(), name, type: 'work', initials: initialsOf(name), maxUnits: 1, costPerHour: 0, notes: '', ...partial };
}

/** Proyecto de ejemplo para que la app no se vea vacía la primera vez. */
export function sampleProject(): Project {
  const p = emptyProject('Construcción de bodega');
  p.start = '2026-11-02';
  const t = (name: string, durationDays: number, level: number) => newTask({ name, durationDays, level });
  const tasks = [
    t('Diseño y permisos', 0, 0),
    t('Levantamiento topográfico', 3, 1),
    t('Diseño de arquitectura', 10, 1),
    t('Permiso de edificación', 15, 1),
    t('Permiso aprobado', 0, 1),
    t('Obras civiles', 0, 0),
    t('Movimiento de tierras', 5, 1),
    t('Fundaciones', 8, 1),
    t('Estructura metálica', 12, 1),
    t('Cubierta y cierres', 10, 1),
    t('Instalaciones', 0, 0),
    t('Eléctricas', 8, 1),
    t('Sanitarias', 6, 1),
    t('Recepción municipal', 0, 0),
  ];
  const d = (from: number, to: number, type: Dependency['type'] = 'FS', lagDays = 0): Dependency => ({
    id: uid(),
    from: tasks[from].id,
    to: tasks[to].id,
    type,
    lagDays,
  });
  p.tasks = tasks;
  p.dependencies = [
    d(1, 2),
    d(2, 3),
    d(3, 4),
    d(4, 6),
    d(6, 7),
    d(7, 8),
    d(8, 9),
    d(8, 11, 'SS', 5),
    d(11, 12),
    d(9, 13),
    d(12, 13),
  ];
  tasks[13].constraint = { type: 'FNLT', date: '2027-02-12' };
  const r = (name: string, maxUnits = 1, costPerHour = 20000) => newResource({ name, maxUnits, costPerHour });
  const res = [r('Topógrafo'), r('Arquitecta', 1, 28000), r('Jefe de obra', 1, 25000), r('Cuadrilla A', 4, 60000), r('Cuadrilla B', 4, 60000), r('Electricista', 2), r('Gasfíter', 1, 18000)];
  res.push(newResource({ name: 'Hormigón', type: 'material', initials: 'HOR', maxUnits: 1, costPerHour: 95000 }));
  p.resources = res;
  const a = (task: number, resource: number, units = 1) => ({ id: uid(), taskId: tasks[task].id, resourceId: res[resource].id, units });
  p.assignments = [
    a(1, 0),
    a(2, 1),
    a(3, 1),
    a(6, 3),
    a(7, 3),
    a(7, 7),
    a(8, 4),
    a(9, 4),
    // El jefe de obra queda sobreasignado: estructura y eléctricas se traslapan.
    a(8, 2),
    a(11, 2),
    a(11, 5),
    a(12, 6),
  ];
  // Línea base guardada con el plan original; luego el permiso se alargó y hay avance registrado.
  p.baseline = takeBaseline(schedule(p));
  p.baseline.savedAt = '2026-10-30T12:00:00.000Z';
  tasks[3].durationDays = 18;
  p.statusDate = '2026-11-27';
  tasks[1].percentComplete = 100;
  tasks[1].actualStart = '2026-11-02';
  tasks[1].actualFinish = '2026-11-04';
  tasks[2].percentComplete = 60;
  tasks[2].actualStart = '2026-11-05';
  return p;
}

interface HistoryEntry {
  project: Project;
}

export interface ProjectState {
  project: Project;
  filePath: string | null;
  dirty: boolean;
  selectedId: string | null;
  zoom: Zoom;
  view: View;
  /** Petición de desplazar la Gantt hasta una fecha; `n` cambia en cada petición. */
  scrollTo: { date: ISODate; n: number } | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  error: string | null;

  select: (id: string | null) => void;
  setZoom: (z: Zoom) => void;
  setView: (v: View) => void;
  goToDate: (date: ISODate) => void;
  setError: (msg: string | null) => void;

  /** Aplica una mutación registrándola en el historial de deshacer. */
  mutate: (fn: (p: Project) => void) => void;
  undo: () => void;
  redo: () => void;

  setProjectName: (name: string) => void;
  setProjectStart: (start: ISODate) => void;
  setStatusDate: (date: ISODate | null) => void;
  saveBaseline: () => void;
  clearBaseline: () => void;
  /** Registra el avance y fija las fechas reales como lo hace Project. */
  setPercentComplete: (id: string, pct: number) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  setConstraint: (id: string, constraint: TaskConstraint) => void;
  updateCalendar: (calendar: Calendar) => void;
  setPredecessors: (id: string, text: string) => void;
  /** Crea un vínculo fin-comienzo; devuelve false (y deja un error) si no es válido. */
  addDependency: (from: string, to: string, type?: Dependency['type']) => boolean;
  removeDependency: (id: string) => void;

  addResource: (partial?: Partial<Resource>) => string;
  updateResource: (id: string, patch: Partial<Resource>) => void;
  deleteResource: (id: string) => void;
  assign: (taskId: string, resourceId: string, units: number) => void;
  setAssignmentUnits: (id: string, units: number) => void;
  unassign: (id: string) => void;
  /** Interpreta la columna "Recursos"; crea los recursos que no existan, como hace Project. */
  setResourceNames: (taskId: string, text: string) => void;
  addTaskAfter: (id: string | null) => string;
  deleteTask: (id: string) => void;
  indent: (id: string) => void;
  outdent: (id: string) => void;
  moveTask: (id: string, direction: -1 | 1) => void;

  loadProject: (p: Project, filePath: string | null) => void;
  newProject: () => void;
  markSaved: (filePath: string | null) => void;
}

const clone = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

const MAX_HISTORY = 200;

export const useProject = create<ProjectState>((set, get) => ({
  project: sampleProject(),
  filePath: null,
  dirty: false,
  selectedId: null,
  zoom: 'week',
  view: 'gantt',
  scrollTo: null,
  past: [],
  future: [],
  error: null,

  select: (id) => set({ selectedId: id }),
  setZoom: (zoom) => set({ zoom }),
  setView: (view) => set({ view }),
  goToDate: (date) => set({ scrollTo: { date, n: (get().scrollTo?.n ?? 0) + 1 } }),
  setError: (error) => set({ error }),

  mutate: (fn) => {
    const { project, past } = get();
    const next = clone(project);
    fn(next);
    set({
      project: next,
      dirty: true,
      past: [...past.slice(-MAX_HISTORY + 1), { project }],
      future: [],
      error: null,
    });
  },

  undo: () => {
    const { past, future, project } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev.project, past: past.slice(0, -1), future: [{ project }, ...future], dirty: true });
  },

  redo: () => {
    const { past, future, project } = get();
    if (!future.length) return;
    const next = future[0];
    set({ project: next.project, future: future.slice(1), past: [...past, { project }], dirty: true });
  },

  setProjectName: (name) => get().mutate((p) => void (p.name = name)),
  setProjectStart: (start) => get().mutate((p) => void (p.start = start)),
  setStatusDate: (date) => get().mutate((p) => void (p.statusDate = date)),
  saveBaseline: () => get().mutate((p) => void (p.baseline = takeBaseline(schedule(p)))),
  clearBaseline: () => get().mutate((p) => void (p.baseline = null)),

  setPercentComplete: (id, pct) =>
    get().mutate((p) => {
      const t = p.tasks.find((x) => x.id === id);
      if (!t) return;
      const sched = schedule(p).tasks.get(id);
      t.percentComplete = pct;
      if (pct === 0) {
        t.actualStart = null;
        t.actualFinish = null;
      } else {
        t.actualStart = t.actualStart ?? sched?.start ?? null;
        t.actualFinish = pct === 100 ? (t.actualFinish ?? sched?.finish ?? null) : null;
      }
    }),

  updateTask: (id, patch) =>
    get().mutate((p) => {
      const t = p.tasks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    }),

  setConstraint: (id, constraint) =>
    get().mutate((p) => {
      const t = p.tasks.find((x) => x.id === id);
      if (t) t.constraint = constraint;
    }),

  updateCalendar: (calendar) =>
    get().mutate((p) => {
      p.calendars = p.calendars.map((c) => (c.id === calendar.id ? calendar : c));
    }),

  setPredecessors: (id, text) => {
    let parsed;
    try {
      parsed = parsePredecessors(text);
    } catch (e) {
      set({ error: (e as Error).message });
      return;
    }
    const { project } = get();
    const rowIdx = project.tasks.findIndex((t) => t.id === id);
    for (const pr of parsed) {
      if (pr.row < 1 || pr.row > project.tasks.length) {
        set({ error: `No existe la tarea ${pr.row}` });
        return;
      }
      if (pr.row - 1 === rowIdx) {
        set({ error: 'Una tarea no puede ser predecesora de sí misma' });
        return;
      }
    }
    get().mutate((p) => {
      p.dependencies = p.dependencies.filter((d) => d.to !== id);
      for (const pr of parsed) {
        p.dependencies.push({ id: uid(), from: p.tasks[pr.row - 1].id, to: id, type: pr.type, lagDays: pr.lagDays });
      }
    });
  },

  addDependency: (from, to, type = 'FS') => {
    const err = linkError(get().project, from, to, type);
    if (err) {
      set({ error: err });
      return false;
    }
    get().mutate((p) => void p.dependencies.push({ id: uid(), from, to, type, lagDays: 0 }));
    return true;
  },

  removeDependency: (id) => get().mutate((p) => void (p.dependencies = p.dependencies.filter((d) => d.id !== id))),

  addResource: (partial = {}) => {
    const r = newResource(partial);
    get().mutate((p) => void p.resources.push(r));
    return r.id;
  },

  updateResource: (id, patch) =>
    get().mutate((p) => {
      const r = p.resources.find((x) => x.id === id);
      if (!r) return;
      Object.assign(r, patch);
      if (patch.name !== undefined && !patch.initials && r.initials === initialsOf(r.name)) r.initials = initialsOf(patch.name);
    }),

  deleteResource: (id) =>
    get().mutate((p) => {
      p.resources = p.resources.filter((r) => r.id !== id);
      p.assignments = p.assignments.filter((a) => a.resourceId !== id);
    }),

  assign: (taskId, resourceId, units) =>
    get().mutate((p) => {
      const existing = p.assignments.find((a) => a.taskId === taskId && a.resourceId === resourceId);
      if (existing) existing.units = units;
      else p.assignments.push({ id: uid(), taskId, resourceId, units });
    }),

  setAssignmentUnits: (id, units) =>
    get().mutate((p) => {
      const a = p.assignments.find((x) => x.id === id);
      if (a) a.units = units;
    }),

  unassign: (id) => get().mutate((p) => void (p.assignments = p.assignments.filter((a) => a.id !== id))),

  setResourceNames: (taskId, text) => {
    let parsed;
    try {
      parsed = parseResourceNames(text);
    } catch (e) {
      set({ error: (e as Error).message });
      return;
    }
    get().mutate((p) => {
      p.assignments = p.assignments.filter((a) => a.taskId !== taskId);
      for (const pr of parsed) {
        let r = p.resources.find((x) => x.name.localeCompare(pr.name, 'es', { sensitivity: 'base' }) === 0);
        if (!r) {
          r = newResource({ name: pr.name });
          p.resources.push(r);
        }
        p.assignments.push({ id: uid(), taskId, resourceId: r.id, units: pr.units });
      }
    });
  },

  addTaskAfter: (id) => {
    const t = newTask();
    get().mutate((p) => {
      if (id === null) {
        p.tasks.push(t);
        return;
      }
      const idx = p.tasks.findIndex((x) => x.id === id);
      const ids = subtreeIds(p.tasks, id);
      t.level = p.tasks[idx].level;
      p.tasks.splice(idx + ids.length, 0, t);
    });
    set({ selectedId: t.id });
    return t.id;
  },

  deleteTask: (id) =>
    get().mutate((p) => {
      const ids = new Set(subtreeIds(p.tasks, id));
      p.tasks = p.tasks.filter((t) => !ids.has(t.id));
      p.dependencies = p.dependencies.filter((d) => !ids.has(d.from) && !ids.has(d.to));
      if (p.tasks.length === 0) p.tasks.push(newTask({ name: 'Tarea 1' }));
    }),

  indent: (id) =>
    get().mutate((p) => {
      const idx = p.tasks.findIndex((t) => t.id === id);
      if (idx <= 0) return;
      if (p.tasks[idx - 1].level < p.tasks[idx].level) return;
      for (const sid of subtreeIds(p.tasks, id)) p.tasks.find((t) => t.id === sid)!.level++;
    }),

  outdent: (id) =>
    get().mutate((p) => {
      const t = p.tasks.find((x) => x.id === id);
      if (!t || t.level === 0) return;
      // Los hermanos que vienen después pasan a ser hijos de esta tarea (como en Project).
      const ids = subtreeIds(p.tasks, id);
      const idx = p.tasks.findIndex((x) => x.id === id);
      const level = t.level;
      for (let i = idx + ids.length; i < p.tasks.length && p.tasks[i].level >= level; i++) p.tasks[i].level++;
      for (const sid of ids) p.tasks.find((x) => x.id === sid)!.level--;
    }),

  moveTask: (id, direction) =>
    get().mutate((p) => {
      const idx = p.tasks.findIndex((t) => t.id === id);
      const ids = subtreeIds(p.tasks, id);
      const block = p.tasks.splice(idx, ids.length);
      let target = idx + direction;
      if (direction === 1 && idx + ids.length < p.tasks.length + ids.length) {
        // Saltar el bloque completo de la tarea siguiente.
        const nextIdx = idx;
        if (nextIdx < p.tasks.length) target = idx + subtreeIds(p.tasks, p.tasks[nextIdx].id).length;
        else target = idx;
      }
      if (direction === -1 && idx > 0) {
        // Buscar el inicio del bloque de la tarea anterior.
        let j = idx - 1;
        const lvl = block[0].level;
        while (j > 0 && p.tasks[j].level > lvl) j--;
        target = j;
      }
      target = Math.max(0, Math.min(p.tasks.length, target));
      p.tasks.splice(target, 0, ...block);
    }),

  loadProject: (project, filePath) =>
    set({ project, filePath, dirty: false, past: [], future: [], selectedId: null, error: null }),
  newProject: () => set({ project: emptyProject(), filePath: null, dirty: false, past: [], future: [], selectedId: null }),
  markSaved: (filePath) => set({ filePath, dirty: false }),
}));
