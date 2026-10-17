import type { Assignment, ISODate, Project, Resource, ScheduledTask } from '../model/types';
import { HOURS_PER_DAY } from '../model/types';
import type { WorkCalendar } from './calendar';
import { addDays, parseDate } from './calendar';
import type { ScheduleResult } from './schedule';

/** Lunes de la semana a la que pertenece una fecha. */
export function weekStart(iso: ISODate): ISODate {
  const dow = parseDate(iso).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

/** Horas de trabajo de una asignación: días laborales × horas por día × unidades. */
export function assignmentHours(task: ScheduledTask | undefined, units: number): number {
  if (!task || task.isMilestone) return 0;
  return task.durationDays * HOURS_PER_DAY * units;
}

export interface WeekLoad {
  week: ISODate;
  hours: number;
  /** Unidades máximas usadas en un mismo día de la semana. */
  peakUnits: number;
  overallocated: boolean;
}

export interface ResourceLoad {
  resourceId: string;
  totalHours: number;
  overallocated: boolean;
  weeks: Map<ISODate, WeekLoad>;
}

export interface LoadResult {
  byResource: Map<string, ResourceLoad>;
  /** Lunes de todas las semanas entre el inicio y el fin del proyecto. */
  weeks: ISODate[];
  overallocatedIds: string[];
}

/**
 * Carga de cada recurso por semana. Un recurso está sobreasignado cuando en
 * algún día laboral la suma de unidades asignadas supera su capacidad máxima.
 */
export function computeResourceLoad(project: Project, result: ScheduleResult, cal: WorkCalendar): LoadResult {
  const weeks: ISODate[] = [];
  for (let w = weekStart(result.projectStart); w <= result.projectFinish; w = addDays(w, 7)) weeks.push(w);

  const byResource = new Map<string, ResourceLoad>();
  const dayUnits = new Map<string, Map<ISODate, number>>();
  for (const r of project.resources) {
    byResource.set(r.id, { resourceId: r.id, totalHours: 0, overallocated: false, weeks: new Map() });
    dayUnits.set(r.id, new Map());
  }
  for (const a of project.assignments) {
    const t = result.tasks.get(a.taskId);
    const days = dayUnits.get(a.resourceId);
    if (!t || !days || t.isMilestone) continue;
    for (let d = t.start; d <= t.finish; d = addDays(d, 1)) {
      if (!cal.isWorkingDay(d)) continue;
      days.set(d, (days.get(d) ?? 0) + a.units);
    }
  }
  for (const r of project.resources) {
    const load = byResource.get(r.id)!;
    for (const [d, units] of dayUnits.get(r.id)!) {
      const w = weekStart(d);
      const wl = load.weeks.get(w) ?? { week: w, hours: 0, peakUnits: 0, overallocated: false };
      wl.hours += units * HOURS_PER_DAY;
      wl.peakUnits = Math.max(wl.peakUnits, units);
      if (units > r.maxUnits + 1e-9) wl.overallocated = true;
      load.weeks.set(w, wl);
      load.totalHours += units * HOURS_PER_DAY;
    }
    load.overallocated = [...load.weeks.values()].some((w) => w.overallocated);
  }
  return { byResource, weeks, overallocatedIds: project.resources.filter((r) => byResource.get(r.id)!.overallocated).map((r) => r.id) };
}

export interface ParsedResourceName {
  name: string;
  units: number;
}

/** Interpreta la columna "Recursos": "Juan Pérez;Cuadrilla A[50%]". */
export function parseResourceNames(text: string): ParsedResourceName[] {
  const out: ParsedResourceName[] = [];
  for (const part of text.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(.*?)\s*(?:\[\s*(\d+(?:[.,]\d+)?)\s*%?\s*\])?$/.exec(part);
    if (!m || !m[1]) throw new Error(`Recurso no válido: "${part}"`);
    const units = m[2] ? parseFloat(m[2].replace(',', '.')) / 100 : 1;
    if (!(units > 0)) throw new Error(`Las unidades de "${m[1]}" deben ser mayores que 0 %`);
    out.push({ name: m[1], units });
  }
  return out;
}

/** Texto de la columna "Recursos" de una tarea, ej. "Juan Pérez;Cuadrilla A[50%]". */
export function formatResourceNames(project: Project, taskId: string): string {
  const byId = new Map(project.resources.map((r) => [r.id, r]));
  return project.assignments
    .filter((a) => a.taskId === taskId && byId.has(a.resourceId))
    .map((a) => `${byId.get(a.resourceId)!.name}${a.units === 1 ? '' : `[${Math.round(a.units * 100)}%]`}`)
    .join(';');
}

export function formatUnits(units: number): string {
  return `${Math.round(units * 100)}%`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('')
    .slice(0, 3);
}

export function assignmentsOf(project: Project, taskId: string): (Assignment & { resource: Resource })[] {
  const byId = new Map(project.resources.map((r) => [r.id, r]));
  return project.assignments
    .filter((a) => a.taskId === taskId && byId.has(a.resourceId))
    .map((a) => ({ ...a, resource: byId.get(a.resourceId)! }));
}
