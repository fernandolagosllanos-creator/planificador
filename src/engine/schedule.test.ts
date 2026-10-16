import { describe, expect, it } from 'vitest';
import type { Project, Task } from '../model/types';
import { WorkCalendar, defaultCalendar } from './calendar';
import { computeWbs, formatPredecessors, parsePredecessors, schedule } from './schedule';

function task(id: string, name: string, durationDays: number, level = 0, manualStart: string | null = null): Task {
  return { id, name, level, durationDays, manualStart, percentComplete: 0, notes: '' };
}

function project(tasks: Task[], deps: Project['dependencies'] = []): Project {
  return {
    id: 'p',
    name: 'Prueba',
    start: '2026-11-02', // lunes
    calendarId: 'cal-std',
    calendars: [defaultCalendar()],
    tasks,
    dependencies: deps,
  };
}

describe('WorkCalendar', () => {
  const cal = new WorkCalendar(defaultCalendar());

  it('salta fines de semana', () => {
    expect(cal.addWorkingDays('2026-11-06', 1)).toBe('2026-11-09'); // viernes → lunes
    expect(cal.addWorkingDays('2026-11-02', 4)).toBe('2026-11-06');
    expect(cal.addWorkingDays('2026-11-02', 5)).toBe('2026-11-09');
  });

  it('salta feriados', () => {
    // 8 de diciembre de 2026 es martes y feriado.
    expect(cal.addWorkingDays('2026-12-07', 1)).toBe('2026-12-09');
    expect(cal.isWorkingDay('2026-12-08')).toBe(false);
  });

  it('cuenta días laborales en un intervalo', () => {
    expect(cal.workingDaysBetween('2026-11-02', '2026-11-13')).toBe(10);
  });

  it('retrocede días laborales', () => {
    expect(cal.addWorkingDays('2026-11-09', -1)).toBe('2026-11-06');
  });
});

describe('schedule', () => {
  it('programa una cadena fin-comienzo', () => {
    const p = project(
      [task('a', 'A', 5), task('b', 'B', 3)],
      [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lagDays: 0 }],
    );
    const r = schedule(p);
    expect(r.tasks.get('a')).toMatchObject({ start: '2026-11-02', finish: '2026-11-06' });
    expect(r.tasks.get('b')).toMatchObject({ start: '2026-11-09', finish: '2026-11-11' });
    expect(r.projectFinish).toBe('2026-11-11');
  });

  it('aplica retraso y adelanto en días laborales', () => {
    const p = project(
      [task('a', 'A', 5), task('b', 'B', 2), task('c', 'C', 2)],
      [
        { id: 'd1', from: 'a', to: 'b', type: 'FS', lagDays: 2 },
        { id: 'd2', from: 'a', to: 'c', type: 'FS', lagDays: -2 },
      ],
    );
    const r = schedule(p);
    expect(r.tasks.get('b')!.start).toBe('2026-11-11');
    expect(r.tasks.get('c')!.start).toBe('2026-11-05');
  });

  it('soporta CC, FF y CF', () => {
    const p = project(
      [task('a', 'A', 5), task('ss', 'SS', 2), task('ff', 'FF', 2), task('sf', 'SF', 2)],
      [
        { id: 'd1', from: 'a', to: 'ss', type: 'SS', lagDays: 0 },
        { id: 'd2', from: 'a', to: 'ff', type: 'FF', lagDays: 0 },
        { id: 'd3', from: 'a', to: 'sf', type: 'SF', lagDays: 0 },
      ],
    );
    const r = schedule(p);
    expect(r.tasks.get('ss')!.start).toBe('2026-11-02');
    expect(r.tasks.get('ff')!.finish).toBe('2026-11-06');
    expect(r.tasks.get('ff')!.start).toBe('2026-11-05');
    // CF: la sucesora termina cuando la predecesora comienza (día anterior).
    expect(r.tasks.get('sf')!.finish).toBe('2026-10-30');
  });

  it('toma la predecesora más tardía', () => {
    const p = project(
      [task('a', 'A', 2), task('b', 'B', 5), task('c', 'C', 1)],
      [
        { id: 'd1', from: 'a', to: 'c', type: 'FS', lagDays: 0 },
        { id: 'd2', from: 'b', to: 'c', type: 'FS', lagDays: 0 },
      ],
    );
    expect(schedule(p).tasks.get('c')!.start).toBe('2026-11-09');
  });

  it('calcula tareas resumen, hitos y EDT', () => {
    const tasks = [
      task('s', 'Fase 1', 0, 0),
      task('a', 'A', 3, 1),
      task('b', 'B', 2, 1),
      task('m', 'Hito', 0, 1),
      task('x', 'Fuera', 1, 0),
    ];
    const p = project(tasks, [
      { id: 'd1', from: 'a', to: 'b', type: 'FS', lagDays: 0 },
      { id: 'd2', from: 'b', to: 'm', type: 'FS', lagDays: 0 },
    ]);
    const r = schedule(p);
    const s = r.tasks.get('s')!;
    expect(s.isSummary).toBe(true);
    expect(s.start).toBe('2026-11-02');
    expect(s.finish).toBe('2026-11-09');
    expect(s.durationDays).toBe(6);
    expect(r.tasks.get('m')).toMatchObject({ isMilestone: true, start: '2026-11-09', finish: '2026-11-09' });
    expect(computeWbs(tasks).get('b')).toBe('1.2');
    expect(computeWbs(tasks).get('x')).toBe('2');
  });

  it('propaga dependencias sobre una tarea resumen a sus hojas', () => {
    const tasks = [task('s', 'Fase', 0, 0), task('a', 'A', 3, 1), task('b', 'B', 1, 1), task('c', 'C', 1, 0)];
    const p = project(tasks, [{ id: 'd1', from: 's', to: 'c', type: 'FS', lagDays: 0 }]);
    expect(schedule(p).tasks.get('c')!.start).toBe('2026-11-05');
  });

  it('marca la ruta crítica y la holgura', () => {
    const p = project(
      [task('a', 'A', 5), task('b', 'B', 2), task('c', 'C', 1)],
      [
        { id: 'd1', from: 'a', to: 'c', type: 'FS', lagDays: 0 },
        { id: 'd2', from: 'b', to: 'c', type: 'FS', lagDays: 0 },
      ],
    );
    const r = schedule(p);
    expect(r.tasks.get('a')!.isCritical).toBe(true);
    expect(r.tasks.get('c')!.isCritical).toBe(true);
    expect(r.tasks.get('b')!.isCritical).toBe(false);
    expect(r.tasks.get('b')!.slackDays).toBe(3);
  });

  it('detecta ciclos sin colgarse', () => {
    const p = project(
      [task('a', 'A', 1), task('b', 'B', 1)],
      [
        { id: 'd1', from: 'a', to: 'b', type: 'FS', lagDays: 0 },
        { id: 'd2', from: 'b', to: 'a', type: 'FS', lagDays: 0 },
      ],
    );
    expect(schedule(p).cycle.sort()).toEqual(['a', 'b']);
  });

  it('usa el inicio manual cuando no hay predecesoras', () => {
    const p = project([task('a', 'A', 1, 0, '2026-11-07')]); // sábado → lunes 9
    expect(schedule(p).tasks.get('a')!.start).toBe('2026-11-09');
  });
});

describe('predecesoras', () => {
  it('interpreta y escribe el texto de la columna', () => {
    expect(parsePredecessors('3FC+2d;5CC;7;2ff-1')).toEqual([
      { row: 3, type: 'FS', lagDays: 2 },
      { row: 5, type: 'SS', lagDays: 0 },
      { row: 7, type: 'FS', lagDays: 0 },
      { row: 2, type: 'FF', lagDays: -1 },
    ]);
    expect(() => parsePredecessors('abc')).toThrow();
    const p = project(
      [task('a', 'A', 1), task('b', 'B', 1), task('c', 'C', 1)],
      [
        { id: 'd1', from: 'a', to: 'c', type: 'FS', lagDays: 2 },
        { id: 'd2', from: 'b', to: 'c', type: 'SS', lagDays: 0 },
      ],
    );
    expect(formatPredecessors(p, 'c')).toBe('1+2d;2CC');
  });
});
