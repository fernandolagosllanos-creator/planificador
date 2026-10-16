import type { Dependency, DependencyType, ISODate, Project, ScheduledTask, Task } from '../model/types';
import { DEP_FROM_ES, DEP_LABEL_ES } from '../model/types';
import { WorkCalendar, maxDate, minDate } from './calendar';

export interface ScheduleResult {
  tasks: Map<string, ScheduledTask>;
  order: ScheduledTask[];
  projectStart: ISODate;
  projectFinish: ISODate;
  /** Ids de tareas que forman un ciclo de dependencias (si lo hay). */
  cycle: string[];
}

/** Devuelve el id del padre de cada tarea según los niveles de sangría. */
export function computeParents(tasks: Task[]): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  const stack: Task[] = [];
  for (const t of tasks) {
    while (stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
    parents.set(t.id, stack.length ? stack[stack.length - 1].id : null);
    stack.push(t);
  }
  return parents;
}

export function computeChildren(tasks: Task[]): Map<string, string[]> {
  const parents = computeParents(tasks);
  const children = new Map<string, string[]>();
  for (const t of tasks) children.set(t.id, []);
  for (const t of tasks) {
    const p = parents.get(t.id);
    if (p) children.get(p)!.push(t.id);
  }
  return children;
}

/** Ids de la tarea y todos sus descendientes, en orden. */
export function subtreeIds(tasks: Task[], id: string): string[] {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return [];
  const level = tasks[idx].level;
  const ids = [id];
  for (let i = idx + 1; i < tasks.length && tasks[i].level > level; i++) ids.push(tasks[i].id);
  return ids;
}

/** Calcula el código EDT (1, 1.1, 1.2, 2…) de cada tarea. */
export function computeWbs(tasks: Task[]): Map<string, string> {
  const wbs = new Map<string, string>();
  const counters: number[] = [];
  for (const t of tasks) {
    counters.length = t.level + 1;
    counters[t.level] = (counters[t.level] ?? 0) + 1;
    for (let i = 0; i < t.level; i++) counters[i] = counters[i] ?? 1;
    wbs.set(t.id, counters.join('.'));
  }
  return wbs;
}

function shiftByType(
  cal: WorkCalendar,
  type: DependencyType,
  pred: { start: ISODate; finish: ISODate },
  lagDays: number,
  succDuration: number,
): ISODate {
  const span = Math.max(succDuration - 1, 0);
  switch (type) {
    case 'FS':
      return cal.addWorkingDays(pred.finish, 1 + lagDays);
    case 'SS':
      return cal.addWorkingDays(pred.start, lagDays);
    case 'FF': {
      const finish = cal.addWorkingDays(pred.finish, lagDays);
      return cal.addWorkingDays(finish, -span);
    }
    case 'SF': {
      const finish = cal.addWorkingDays(pred.start, lagDays - 1);
      return cal.addWorkingDays(finish, -span);
    }
  }
}

/**
 * Motor de programación: calcula inicio y fin de cada tarea respetando el
 * calendario, las dependencias y la jerarquía, y marca la ruta crítica.
 */
export function schedule(project: Project): ScheduleResult {
  const calDef = project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0];
  const cal = new WorkCalendar(calDef);
  const tasks = project.tasks;
  const parents = computeParents(tasks);
  const children = computeChildren(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isSummary = (id: string) => (children.get(id)?.length ?? 0) > 0;

  // Las dependencias sobre tareas resumen se propagan a sus hojas.
  const leaves = (id: string): string[] =>
    isSummary(id) ? children.get(id)!.flatMap(leaves) : [id];

  const preds = new Map<string, { dep: Dependency; from: string }[]>();
  const succs = new Map<string, { dep: Dependency; to: string }[]>();
  for (const t of tasks) {
    preds.set(t.id, []);
    succs.set(t.id, []);
  }
  const valid: Dependency[] = project.dependencies.filter((d) => byId.has(d.from) && byId.has(d.to));
  for (const dep of valid) {
    const fromLeaves = leaves(dep.from);
    const toLeaves = leaves(dep.to);
    for (const f of fromLeaves)
      for (const to of toLeaves) {
        if (f === to) continue;
        preds.get(to)!.push({ dep, from: f });
        succs.get(f)!.push({ dep, to });
      }
  }

  // Orden topológico (Kahn) sobre las hojas.
  const leafIds = tasks.filter((t) => !isSummary(t.id)).map((t) => t.id);
  const indeg = new Map(leafIds.map((id) => [id, preds.get(id)!.length]));
  const queue = leafIds.filter((id) => indeg.get(id) === 0);
  const topo: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    topo.push(id);
    for (const s of succs.get(id)!) {
      indeg.set(s.to, indeg.get(s.to)! - 1);
      if (indeg.get(s.to) === 0) queue.push(s.to);
    }
  }
  const cycle = leafIds.filter((id) => !topo.includes(id));

  const projStart = cal.nextWorkingDay(project.start);
  const result = new Map<string, ScheduledTask>();
  const early = new Map<string, { start: ISODate; finish: ISODate }>();

  // Pasada hacia adelante.
  for (const id of [...topo, ...cycle]) {
    const t = byId.get(id)!;
    const dur = Math.max(0, Math.round(t.durationDays));
    let start: ISODate;
    const ps = preds.get(id)!.filter((p) => early.has(p.from));
    if (ps.length === 0) {
      start = cal.nextWorkingDay(t.manualStart ?? projStart);
    } else {
      start = projStart;
      let first = true;
      for (const p of ps) {
        const s = shiftByType(cal, p.dep.type, early.get(p.from)!, p.dep.lagDays, dur);
        start = first ? s : maxDate(start, s);
        first = false;
      }
    }
    const finish = dur === 0 ? start : cal.addWorkingDays(start, dur - 1);
    early.set(id, { start, finish });
  }

  let projectFinish = projStart;
  for (const v of early.values()) projectFinish = maxDate(projectFinish, v.finish);

  // Pasada hacia atrás (holgura total) sobre fechas de fin tardías.
  const lateFinish = new Map<string, ISODate>();
  for (const id of [...topo].reverse()) {
    const dur = Math.max(0, Math.round(byId.get(id)!.durationDays));
    const span = Math.max(dur - 1, 0);
    let lf: ISODate | null = null;
    for (const s of succs.get(id)!) {
      const succEarly = early.get(s.to)!;
      const succLF = lateFinish.get(s.to) ?? projectFinish;
      const succDur = Math.max(0, Math.round(byId.get(s.to)!.durationDays));
      const succSpan = Math.max(succDur - 1, 0);
      const succLS = cal.addWorkingDays(succLF, -succSpan);
      let candidate: ISODate;
      switch (s.dep.type) {
        case 'FS':
          candidate = cal.addWorkingDays(succLS, -(1 + s.dep.lagDays));
          break;
        case 'SS':
          candidate = cal.addWorkingDays(cal.addWorkingDays(succLS, -s.dep.lagDays), span);
          break;
        case 'FF':
          candidate = cal.addWorkingDays(succLF, -s.dep.lagDays);
          break;
        case 'SF':
          candidate = cal.addWorkingDays(cal.addWorkingDays(succLF, -(s.dep.lagDays - 1)), span);
          break;
      }
      void succEarly;
      lf = lf === null ? candidate : minDate(lf, candidate);
    }
    lateFinish.set(id, lf ?? projectFinish);
  }

  tasks.forEach((t, i) => {
    if (isSummary(t.id)) return;
    const e = early.get(t.id)!;
    const lf = lateFinish.get(t.id) ?? projectFinish;
    const slack = Math.max(0, cal.workingDaysBetween(e.finish, lf) - 1);
    result.set(t.id, {
      id: t.id,
      start: e.start,
      finish: e.finish,
      durationDays: Math.max(0, Math.round(t.durationDays)),
      isSummary: false,
      isMilestone: Math.round(t.durationDays) === 0,
      percentComplete: t.percentComplete,
      slackDays: slack,
      isCritical: slack === 0 && Math.round(t.durationDays) > 0,
      row: i + 1,
      level: t.level,
      parentId: parents.get(t.id) ?? null,
    });
  });

  // Tareas resumen: de abajo hacia arriba.
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    if (!isSummary(t.id)) continue;
    const kids = children.get(t.id)!.map((k) => result.get(k)!).filter(Boolean);
    let start = kids[0].start;
    let finish = kids[0].finish;
    let weighted = 0;
    let total = 0;
    for (const k of kids) {
      start = minDate(start, k.start);
      finish = maxDate(finish, k.finish);
      const w = Math.max(k.durationDays, k.isMilestone ? 0 : 1);
      weighted += w * k.percentComplete;
      total += w;
    }
    result.set(t.id, {
      id: t.id,
      start,
      finish,
      durationDays: cal.workingDaysBetween(start, finish),
      isSummary: true,
      isMilestone: false,
      percentComplete: total ? Math.round(weighted / total) : 0,
      slackDays: 0,
      isCritical: kids.some((k) => k.isCritical),
      row: i + 1,
      level: t.level,
      parentId: parents.get(t.id) ?? null,
    });
  }

  const order = tasks.map((t) => result.get(t.id)!);
  return { tasks: result, order, projectStart: projStart, projectFinish, cycle };
}

/** Texto de la columna "Predecesoras" para una tarea, ej. "3FC+2d;5CC". */
export function formatPredecessors(project: Project, taskId: string): string {
  const rowOf = new Map(project.tasks.map((t, i) => [t.id, i + 1]));
  return project.dependencies
    .filter((d) => d.to === taskId && rowOf.has(d.from))
    .map((d) => {
      const row = rowOf.get(d.from)!;
      const type = d.type === 'FS' ? '' : DEP_LABEL_ES[d.type];
      const lag = d.lagDays === 0 ? '' : `${d.lagDays > 0 ? '+' : ''}${d.lagDays}d`;
      return `${row}${type}${lag}`;
    })
    .join(';');
}

export interface ParsedPredecessor {
  row: number;
  type: DependencyType;
  lagDays: number;
}

/** Interpreta "3FC+2d;5CC;7" → lista de predecesoras. Lanza error si está mal escrito. */
export function parsePredecessors(text: string): ParsedPredecessor[] {
  const out: ParsedPredecessor[] = [];
  for (const part of text.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*([A-Za-z]{2})?\s*([+-]\s*\d+(?:[.,]\d+)?)?\s*[dD]?$/.exec(part);
    if (!m) throw new Error(`Predecesora no válida: "${part}"`);
    const type = m[2] ? DEP_FROM_ES[m[2].toUpperCase()] : 'FS';
    if (!type) throw new Error(`Tipo de dependencia no válido: "${m[2]}" (usa FC, CC, FF o CF)`);
    const lag = m[3] ? Math.round(parseFloat(m[3].replace(/\s/g, '').replace(',', '.'))) : 0;
    out.push({ row: parseInt(m[1], 10), type, lagDays: lag });
  }
  return out;
}
