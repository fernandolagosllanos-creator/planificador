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

/** Posición temprana de una tarea hoja. `eod` indica que el fin ocurre al terminar el día (siempre, salvo hitos al comienzo del día). */
interface Placement {
  start: ISODate;
  finish: ISODate;
  eod: boolean;
}

const spanOf = (dur: number) => Math.max(dur - 1, 0);

/** Días laborales que separan el fin de la predecesora del comienzo de la sucesora en un vínculo FC. */
const fsOffset = (pred: Placement, succDur: number, lag: number) => (pred.eod && succDur > 0 ? 1 : 0) + lag;

/** Ubicación de la sucesora que exige un vínculo, sin considerar otras predecesoras. */
function placeBySuccessorLink(cal: WorkCalendar, type: DependencyType, pred: Placement, lag: number, dur: number): Placement {
  const span = spanOf(dur);
  switch (type) {
    case 'FS': {
      const start = cal.addWorkingDays(pred.finish, fsOffset(pred, dur, lag));
      return { start, finish: cal.addWorkingDays(start, span), eod: dur > 0 || pred.eod };
    }
    case 'SS': {
      const start = cal.addWorkingDays(pred.start, lag);
      return { start, finish: cal.addWorkingDays(start, span), eod: dur > 0 };
    }
    case 'FF': {
      const finish = cal.addWorkingDays(pred.finish, lag);
      return { start: cal.addWorkingDays(finish, -span), finish, eod: dur > 0 || pred.eod };
    }
    case 'SF': {
      const finish = cal.addWorkingDays(pred.start, lag - 1);
      return { start: cal.addWorkingDays(finish, -span), finish, eod: true };
    }
  }
}

/** Orden en el tiempo de dos ubicaciones (un hito al final del día va después de uno al comienzo). */
function laterThan(a: Placement, b: Placement): boolean {
  if (a.start !== b.start) return a.start > b.start;
  return a.eod && !b.eod;
}

/** Fin más tardío que puede tener la predecesora para no atrasar a la sucesora ubicada en `succ`. */
function latestPredFinish(
  cal: WorkCalendar,
  type: DependencyType,
  pred: Placement,
  predDur: number,
  succ: { start: ISODate; finish: ISODate },
  succDur: number,
  lag: number,
): ISODate {
  const span = spanOf(predDur);
  switch (type) {
    case 'FS':
      return cal.addWorkingDays(succ.start, -fsOffset(pred, succDur, lag));
    case 'SS':
      return cal.addWorkingDays(cal.addWorkingDays(succ.start, -lag), span);
    case 'FF':
      return cal.addWorkingDays(succ.finish, -lag);
    case 'SF':
      return cal.addWorkingDays(cal.addWorkingDays(succ.finish, 1 - lag), span);
  }
}

/**
 * Motor de programación: calcula inicio y fin de cada tarea respetando el
 * calendario, las dependencias, las restricciones y la jerarquía, y marca la
 * ruta crítica. Como Project, las restricciones con fecha se respetan aunque
 * choquen con las predecesoras; en ese caso la tarea queda marcada con conflicto.
 */
export function schedule(project: Project): ScheduleResult {
  const calDef = project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0];
  const cal = new WorkCalendar(calDef);
  const tasks = project.tasks;
  const parents = computeParents(tasks);
  const children = computeChildren(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isSummary = (id: string) => (children.get(id)?.length ?? 0) > 0;
  const durOf = (id: string) => Math.max(0, Math.round(byId.get(id)!.durationDays));

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
  const inTopo = new Set(topo);
  const cycle = leafIds.filter((id) => !inTopo.has(id));

  const projStart = cal.nextWorkingDay(project.start);
  const early = new Map<string, Placement>();
  const conflict = new Set<string>();

  // Pasada hacia adelante.
  for (const id of [...topo, ...cycle]) {
    const t = byId.get(id)!;
    const dur = durOf(id);
    const span = spanOf(dur);
    let p: Placement = { start: projStart, finish: cal.addWorkingDays(projStart, span), eod: dur > 0 };
    for (const pr of preds.get(id)!) {
      const pe = early.get(pr.from);
      if (!pe) continue;
      const cand = placeBySuccessorLink(cal, pr.dep.type, pe, pr.dep.lagDays, dur);
      if (laterThan(cand, p)) p = cand;
    }
    const c = t.constraint;
    if (c && c.date && c.type !== 'ASAP' && c.type !== 'ALAP') {
      const atStart = (d: ISODate): Placement => {
        const start = cal.nextWorkingDay(d);
        return { start, finish: cal.addWorkingDays(start, span), eod: dur > 0 };
      };
      const atFinish = (d: ISODate): Placement => {
        const finish = cal.prevWorkingDay(d);
        return { start: cal.addWorkingDays(finish, -span), finish, eod: true };
      };
      switch (c.type) {
        case 'SNET': {
          const q = atStart(c.date);
          if (laterThan(q, p)) p = q;
          break;
        }
        case 'FNET': {
          const q = atFinish(c.date);
          if (q.finish > p.finish) p = q;
          break;
        }
        case 'SNLT': {
          const q = atStart(c.date);
          if (laterThan(p, q)) {
            conflict.add(id);
            p = q;
          }
          break;
        }
        case 'FNLT': {
          const q = atFinish(c.date);
          if (p.finish > q.finish) {
            conflict.add(id);
            p = q;
          }
          break;
        }
        case 'MSO': {
          const q = atStart(c.date);
          if (laterThan(p, q)) conflict.add(id);
          p = q;
          break;
        }
        case 'MFO': {
          const q = atFinish(c.date);
          if (p.finish > q.finish) conflict.add(id);
          p = q;
          break;
        }
      }
    }
    early.set(id, p);
  }

  let projectFinish = projStart;
  for (const v of early.values()) projectFinish = maxDate(projectFinish, v.finish);

  // Pasada hacia atrás: fin más tardío de cada hoja.
  const lateFinish = new Map<string, ISODate>();
  const lateStartOf = (id: string) => cal.addWorkingDays(lateFinish.get(id) ?? projectFinish, -spanOf(durOf(id)));
  for (const id of [...topo].reverse()) {
    const dur = durOf(id);
    let lf = projectFinish;
    for (const s of succs.get(id)!) {
      const succ = { start: lateStartOf(s.to), finish: lateFinish.get(s.to) ?? projectFinish };
      lf = minDate(lf, latestPredFinish(cal, s.dep.type, early.get(id)!, dur, succ, durOf(s.to), s.dep.lagDays));
    }
    const c = byId.get(id)!.constraint;
    if (c && c.date) {
      if (c.type === 'FNLT') lf = minDate(lf, cal.prevWorkingDay(c.date));
      else if (c.type === 'SNLT') lf = minDate(lf, cal.addWorkingDays(cal.nextWorkingDay(c.date), spanOf(dur)));
      else if (c.type === 'MSO' || c.type === 'MFO') lf = early.get(id)!.finish;
    }
    lateFinish.set(id, lf);
  }

  // Lo más tarde posible: se corre hasta tocar a sus sucesoras (o el fin del proyecto).
  for (const id of [...topo].reverse()) {
    if (byId.get(id)!.constraint?.type !== 'ALAP') continue;
    const dur = durOf(id);
    const e = early.get(id)!;
    let lf = projectFinish;
    for (const s of succs.get(id)!) {
      const succ = early.get(s.to)!;
      lf = minDate(lf, latestPredFinish(cal, s.dep.type, e, dur, succ, durOf(s.to), s.dep.lagDays));
    }
    if (lf > e.finish) early.set(id, { start: cal.addWorkingDays(lf, -spanOf(dur)), finish: lf, eod: true });
  }

  const result = new Map<string, ScheduledTask>();
  tasks.forEach((t, i) => {
    if (isSummary(t.id)) return;
    const e = early.get(t.id)!;
    const dur = durOf(t.id);
    const lf = lateFinish.get(t.id) ?? projectFinish;
    const slack = cal.workingDaysDiff(e.finish, lf);
    result.set(t.id, {
      id: t.id,
      start: e.start,
      finish: e.finish,
      durationDays: dur,
      isSummary: false,
      isMilestone: dur === 0,
      percentComplete: t.percentComplete,
      slackDays: slack,
      lateStart: cal.addWorkingDays(lf, -spanOf(dur)),
      lateFinish: lf,
      isCritical: slack <= 0,
      constraintConflict: conflict.has(t.id),
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
    let slack = kids[0].slackDays;
    for (const k of kids) {
      start = minDate(start, k.start);
      finish = maxDate(finish, k.finish);
      slack = Math.min(slack, k.slackDays);
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
      slackDays: slack,
      lateStart: start,
      lateFinish: finish,
      isCritical: kids.some((k) => k.isCritical),
      constraintConflict: kids.some((k) => k.constraintConflict),
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

/**
 * Comprueba si se puede vincular `from` → `to`. Devuelve el motivo en español
 * cuando no se puede (misma tarea, vínculo repetido, tarea dentro de su propio
 * resumen o ciclo de dependencias) y null cuando sí.
 */
export function linkError(project: Project, from: string, to: string, type: DependencyType = 'FS'): string | null {
  if (from === to) return 'Una tarea no puede ser predecesora de sí misma';
  const rowOf = new Map(project.tasks.map((t, i) => [t.id, i + 1]));
  if (!rowOf.has(from) || !rowOf.has(to)) return 'La tarea no existe';
  if (subtreeIds(project.tasks, from).includes(to) || subtreeIds(project.tasks, to).includes(from))
    return 'No se puede vincular una tarea resumen con una de sus subtareas';
  if (project.dependencies.some((d) => d.from === from && d.to === to)) return `Las tareas ${rowOf.get(from)} y ${rowOf.get(to)} ya están vinculadas`;
  const trial: Project = { ...project, dependencies: [...project.dependencies, { id: '__trial', from, to, type, lagDays: 0 }] };
  if (schedule(trial).cycle.length) return `Vincular ${rowOf.get(from)} → ${rowOf.get(to)} crearía un ciclo de dependencias`;
  return null;
}
