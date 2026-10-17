import type { Baseline, ISODate, ScheduledTask } from '../model/types';
import type { WorkCalendar } from './calendar';
import type { ScheduleResult } from './schedule';

/** Copia las fechas programadas actuales como línea base. */
export function takeBaseline(result: ScheduleResult): Baseline {
  const tasks: Baseline['tasks'] = {};
  for (const t of result.order) tasks[t.id] = { start: t.start, finish: t.finish, durationDays: t.durationDays };
  return { savedAt: new Date().toISOString(), tasks };
}

export interface Variance {
  baselineStart: ISODate;
  baselineFinish: ISODate;
  baselineDurationDays: number;
  /** Días laborales de desviación; positivo = más tarde que la línea base. */
  startVariance: number;
  finishVariance: number;
}

export function varianceOf(task: ScheduledTask, baseline: Baseline | null, cal: WorkCalendar): Variance | null {
  const b = baseline?.tasks[task.id];
  if (!b) return null;
  return {
    baselineStart: b.start,
    baselineFinish: b.finish,
    baselineDurationDays: b.durationDays,
    startVariance: cal.workingDaysDiff(b.start, task.start),
    finishVariance: cal.workingDaysDiff(b.finish, task.finish),
  };
}

/** Porcentaje que debería llevar la tarea a la fecha de estado si fuera según lo programado. */
export function plannedPercent(task: ScheduledTask, statusDate: ISODate, cal: WorkCalendar): number {
  if (statusDate < task.start) return 0;
  if (statusDate >= task.finish || task.durationDays === 0) return 100;
  return Math.round((cal.workingDaysBetween(task.start, statusDate) / task.durationDays) * 100);
}

export interface ProgressPoint {
  row: number;
  /** Fecha por la que pasa la línea de progreso en esta fila. */
  date: ISODate;
  /** La tarea va atrasada respecto a la fecha de estado. */
  behind: boolean;
}

/**
 * Puntos de la línea de progreso, como en Project: la línea baja por la fecha
 * de estado y se desvía hacia la izquierda en las tareas que deberían haber
 * avanzado más (atrasadas) y hacia la derecha en las adelantadas.
 */
export function progressPoints(result: ScheduleResult, statusDate: ISODate, cal: WorkCalendar): ProgressPoint[] {
  return result.order.map((t) => {
    if (t.isSummary || t.isMilestone || t.percentComplete >= 100 || t.start > statusDate) return { row: t.row, date: statusDate, behind: false };
    const done = Math.round((t.durationDays * t.percentComplete) / 100);
    const date = done === 0 ? cal.addWorkingDays(t.start, -1) : cal.addWorkingDays(t.start, done - 1);
    const planned = plannedPercent(t, statusDate, cal);
    if (t.percentComplete >= planned) return { row: t.row, date: statusDate, behind: false };
    return { row: t.row, date, behind: true };
  });
}

/** Avance real y planificado del proyecto, ponderados por duración de las tareas hoja. */
export function projectProgress(result: ScheduleResult, statusDate: ISODate | null, cal: WorkCalendar): { actual: number; planned: number } {
  let total = 0;
  let actual = 0;
  let planned = 0;
  for (const t of result.order) {
    if (t.isSummary || t.isMilestone) continue;
    total += t.durationDays;
    actual += t.durationDays * t.percentComplete;
    if (statusDate) planned += t.durationDays * plannedPercent(t, statusDate, cal);
  }
  return { actual: total ? Math.round(actual / total) : 0, planned: total ? Math.round(planned / total) : 0 };
}
