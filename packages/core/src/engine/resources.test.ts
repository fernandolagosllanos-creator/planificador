import { describe, expect, it } from 'vitest';
import type { Project, Resource, Task } from '../model/types';
import { WorkCalendar, defaultCalendar } from './calendar';
import { assignmentHours, computeResourceLoad, formatResourceNames, parseResourceNames, weekStart } from './resources';
import { schedule } from './schedule';

function task(id: string, name: string, durationDays: number): Task {
  return { id, name, level: 0, durationDays, constraint: { type: 'ASAP', date: null }, percentComplete: 0, actualStart: null, actualFinish: null, notes: '' };
}

function resource(id: string, name: string, maxUnits = 1): Resource {
  return { id, name, type: 'work', initials: '', maxUnits, costPerHour: 0, notes: '' };
}

function project(tasks: Task[], resources: Resource[], assignments: Project['assignments']): Project {
  return {
    id: 'p',
    name: 'Prueba',
    start: '2026-11-02', // lunes
    statusDate: null,
    baseline: null,
    calendarId: 'cal-std',
    calendars: [defaultCalendar()],
    tasks,
    dependencies: [],
    resources,
    assignments,
  };
}

const cal = new WorkCalendar(defaultCalendar());

describe('recursos', () => {
  it('calcula las semanas desde el lunes', () => {
    expect(weekStart('2026-11-05')).toBe('2026-11-02'); // jueves → lunes
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // domingo → lunes anterior
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
  });

  it('calcula el trabajo con 8 horas por día laboral', () => {
    const p = project([task('a', 'A', 5)], [resource('r', 'Juan')], [{ id: 'x', taskId: 'a', resourceId: 'r', units: 0.5 }]);
    const r = schedule(p);
    expect(assignmentHours(r.tasks.get('a'), 0.5)).toBe(20);
    expect(computeResourceLoad(p, r, cal).byResource.get('r')!.totalHours).toBe(20);
  });

  it('detecta sobreasignación cuando dos tareas se traslapan al 100 %', () => {
    const p = project(
      [task('a', 'A', 5), task('b', 'B', 3)],
      [resource('r', 'Juan')],
      [
        { id: 'x', taskId: 'a', resourceId: 'r', units: 1 },
        { id: 'y', taskId: 'b', resourceId: 'r', units: 1 },
      ],
    );
    const load = computeResourceLoad(p, schedule(p), cal);
    expect(load.overallocatedIds).toEqual(['r']);
    const week = load.byResource.get('r')!.weeks.get('2026-11-02')!;
    expect(week.peakUnits).toBe(2);
    expect(week.hours).toBe(64);
  });

  it('no marca sobreasignación si las unidades caben en la capacidad', () => {
    const p = project(
      [task('a', 'A', 5), task('b', 'B', 5)],
      [resource('r', 'Cuadrilla', 4)],
      [
        { id: 'x', taskId: 'a', resourceId: 'r', units: 2 },
        { id: 'y', taskId: 'b', resourceId: 'r', units: 2 },
      ],
    );
    expect(computeResourceLoad(p, schedule(p), cal).overallocatedIds).toEqual([]);
  });

  it('reparte las horas por semana y salta días no laborables', () => {
    // 8 días desde el lunes 2: semana 1 (5 días) y semana 2 (3 días).
    const p = project([task('a', 'A', 8)], [resource('r', 'Juan')], [{ id: 'x', taskId: 'a', resourceId: 'r', units: 1 }]);
    const r = computeResourceLoad(p, schedule(p), cal).byResource.get('r')!;
    expect(r.weeks.get('2026-11-02')!.hours).toBe(40);
    expect(r.weeks.get('2026-11-09')!.hours).toBe(24);
  });

  it('los hitos no tienen trabajo', () => {
    const p = project([task('m', 'Hito', 0)], [resource('r', 'Juan')], [{ id: 'x', taskId: 'm', resourceId: 'r', units: 1 }]);
    expect(computeResourceLoad(p, schedule(p), cal).byResource.get('r')!.totalHours).toBe(0);
  });

  it('interpreta y escribe la columna Recursos', () => {
    expect(parseResourceNames('Juan Pérez;Cuadrilla A[50%]; Grúa [200]')).toEqual([
      { name: 'Juan Pérez', units: 1 },
      { name: 'Cuadrilla A', units: 0.5 },
      { name: 'Grúa', units: 2 },
    ]);
    expect(() => parseResourceNames('Juan[0%]')).toThrow();
    const p = project(
      [task('a', 'A', 1)],
      [resource('r1', 'Juan Pérez'), resource('r2', 'Cuadrilla A')],
      [
        { id: 'x', taskId: 'a', resourceId: 'r1', units: 1 },
        { id: 'y', taskId: 'a', resourceId: 'r2', units: 0.5 },
      ],
    );
    expect(formatResourceNames(p, 'a')).toBe('Juan Pérez;Cuadrilla A[50%]');
  });
});
