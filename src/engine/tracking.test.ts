import { describe, expect, it } from 'vitest';
import type { Project, Task } from '../model/types';
import { WorkCalendar, defaultCalendar } from './calendar';
import { schedule } from './schedule';
import { plannedPercent, progressPoints, projectProgress, takeBaseline, varianceOf } from './tracking';

function task(id: string, name: string, durationDays: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    name,
    level: 0,
    durationDays,
    constraint: { type: 'ASAP', date: null },
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    notes: '',
    ...extra,
  };
}

function project(tasks: Task[], deps: Project['dependencies'] = []): Project {
  return {
    id: 'p',
    name: 'Prueba',
    start: '2026-11-02', // lunes
    statusDate: null,
    baseline: null,
    calendarId: 'cal-std',
    calendars: [defaultCalendar()],
    tasks,
    dependencies: deps,
    resources: [],
    assignments: [],
  };
}

const cal = new WorkCalendar(defaultCalendar());
const fs = (from: string, to: string) => ({ id: from + to, from, to, type: 'FS' as const, lagDays: 0 });

describe('línea base', () => {
  it('guarda las fechas y mide la variación en días laborales', () => {
    const p = project([task('a', 'A', 5), task('b', 'B', 3)], [fs('a', 'b')]);
    p.baseline = takeBaseline(schedule(p));
    p.tasks[0].durationDays = 7; // A se alarga 2 días → B termina 2 días después
    const r = schedule(p);
    const v = varianceOf(r.tasks.get('b')!, p.baseline, cal)!;
    expect(v.baselineStart).toBe('2026-11-09');
    expect(v.startVariance).toBe(2);
    expect(v.finishVariance).toBe(2);
    expect(varianceOf(r.tasks.get('a')!, p.baseline, cal)!.startVariance).toBe(0);
  });

  it('devuelve null para tareas sin línea base', () => {
    const p = project([task('a', 'A', 1)]);
    expect(varianceOf(schedule(p).tasks.get('a')!, null, cal)).toBeNull();
    p.baseline = { savedAt: '', tasks: {} };
    expect(varianceOf(schedule(p).tasks.get('a')!, p.baseline, cal)).toBeNull();
  });
});

describe('fechas reales', () => {
  it('el comienzo real fija la tarea aunque sus predecesoras digan otra cosa', () => {
    const p = project([task('a', 'A', 5), task('b', 'B', 3, { actualStart: '2026-11-04', percentComplete: 50 })], [fs('a', 'b')]);
    const b = schedule(p).tasks.get('b')!;
    expect(b.start).toBe('2026-11-04');
    expect(b.finish).toBe('2026-11-06');
  });

  it('el fin real redefine la duración', () => {
    const p = project([task('a', 'A', 5, { actualStart: '2026-11-02', actualFinish: '2026-11-04', percentComplete: 100 })]);
    const a = schedule(p).tasks.get('a')!;
    expect(a.finish).toBe('2026-11-04');
    expect(a.durationDays).toBe(3);
  });
});

describe('avance', () => {
  it('calcula el avance planificado a la fecha de estado', () => {
    const t = schedule(project([task('a', 'A', 10)])).tasks.get('a')!; // 2 → 13 nov
    expect(plannedPercent(t, '2026-10-30', cal)).toBe(0);
    expect(plannedPercent(t, '2026-11-06', cal)).toBe(50);
    expect(plannedPercent(t, '2026-11-20', cal)).toBe(100);
  });

  it('la línea de progreso se desvía solo en las tareas atrasadas', () => {
    const p = project([task('a', 'A', 10, { percentComplete: 20 }), task('b', 'B', 10, { percentComplete: 60 }), task('c', 'C', 2)], [fs('b', 'c')]);
    const pts = progressPoints(schedule(p), '2026-11-06', cal); // viernes de la primera semana: 50 % planificado
    expect(pts[0]).toMatchObject({ behind: true, date: '2026-11-03' }); // 2 de 10 días hechos
    expect(pts[1]).toMatchObject({ behind: false, date: '2026-11-06' }); // adelantada: pasa por la fecha de estado
    expect(pts[2]).toMatchObject({ behind: false, date: '2026-11-06' }); // aún no empieza
  });

  it('resume el avance real y planificado del proyecto', () => {
    const p = project([task('a', 'A', 10, { percentComplete: 20 }), task('b', 'B', 10, { percentComplete: 60 })]);
    expect(projectProgress(schedule(p), '2026-11-06', cal)).toEqual({ actual: 40, planned: 50 });
  });
});
