import { create } from 'zustand';
import type { Calendar, Dependency, ISODate, Project, Task, TaskConstraint } from '../model/types';
import { defaultCalendar, today } from '../engine/calendar';
import { parsePredecessors, subtreeIds } from '../engine/schedule';

export type Zoom = 'day' | 'week' | 'month';

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
    notes: '',
    ...partial,
  };
}

export function emptyProject(name = 'Proyecto sin título'): Project {
  return {
    id: uid(),
    name,
    start: today(),
    calendarId: 'cal-std',
    calendars: [defaultCalendar()],
    tasks: [newTask({ name: 'Tarea 1' })],
    dependencies: [],
  };
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
  tasks[1].percentComplete = 100;
  tasks[2].percentComplete = 60;
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
  past: HistoryEntry[];
  future: HistoryEntry[];
  error: string | null;

  select: (id: string | null) => void;
  setZoom: (z: Zoom) => void;
  setError: (msg: string | null) => void;

  /** Aplica una mutación registrándola en el historial de deshacer. */
  mutate: (fn: (p: Project) => void) => void;
  undo: () => void;
  redo: () => void;

  setProjectName: (name: string) => void;
  setProjectStart: (start: ISODate) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  setConstraint: (id: string, constraint: TaskConstraint) => void;
  updateCalendar: (calendar: Calendar) => void;
  setPredecessors: (id: string, text: string) => void;
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
  past: [],
  future: [],
  error: null,

  select: (id) => set({ selectedId: id }),
  setZoom: (zoom) => set({ zoom }),
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
