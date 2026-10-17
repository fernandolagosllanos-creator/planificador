import { describe, expect, it } from 'vitest';
import type { Project, Task, TaskConstraint } from '../model/types';
import { normalizeProject } from '../model/migrate';
import { WorkCalendar, defaultCalendar } from './calendar';
import { computeWbs, formatPredecessors, linkError, parsePredecessors, schedule } from './schedule';

function task(id: string, name: string, durationDays: number, level = 0, constraint: TaskConstraint = { type: 'ASAP', date: null }): Task {
  return { id, name, level, durationDays, constraint, percentComplete: 0, notes: '' };
}

const fs = (id: string, from: string, to: string, lagDays = 0): Project['dependencies'][number] => ({ id, from, to, type: 'FS', lagDays });

function project(tasks: Task[], deps: Project['dependencies'] = []): Project {
  return {
    id: 'p',
    name: 'Prueba',
    start: '2026-11-02', // lunes
    calendarId: 'cal-std',
    calendars: [defaultCalendar()],
    tasks,
    dependencies: deps,
    resources: [],
    assignments: [],
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
        { id: 'd3', from: 'a', to: 'sf', type: 'SF', lagDays: 5 },
      ],
    );
    const r = schedule(p);
    expect(r.tasks.get('ss')!.start).toBe('2026-11-02');
    expect(r.tasks.get('ff')!.finish).toBe('2026-11-06');
    expect(r.tasks.get('ff')!.start).toBe('2026-11-05');
    // CF+5d: la sucesora termina 5 días después de que la predecesora comienza.
    expect(r.tasks.get('sf')).toMatchObject({ start: '2026-11-05', finish: '2026-11-06' });
  });

  it('ninguna tarea comienza antes del inicio del proyecto, como en Project', () => {
    const p = project([task('a', 'A', 5), task('sf', 'SF', 2)], [{ id: 'd', from: 'a', to: 'sf', type: 'SF', lagDays: 0 }]);
    expect(schedule(p).tasks.get('sf')!.start).toBe('2026-11-02');
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
    // El hito ocurre al terminar B (viernes 6), no al día siguiente.
    expect(s.finish).toBe('2026-11-06');
    expect(s.durationDays).toBe(5);
    expect(r.tasks.get('m')).toMatchObject({ isMilestone: true, start: '2026-11-06', finish: '2026-11-06' });
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

  it('usa la restricción "no comenzar antes del" (cae en sábado → lunes)', () => {
    const p = project([task('a', 'A', 1, 0, { type: 'SNET', date: '2026-11-07' })]);
    expect(schedule(p).tasks.get('a')!.start).toBe('2026-11-09');
  });
});

describe('hitos', () => {
  it('la sucesora de un hito comienza el día hábil siguiente al hito, sin perder un día', () => {
    const p = project([task('a', 'A', 5), task('m', 'Hito', 0), task('b', 'B', 2)], [fs('d1', 'a', 'm'), fs('d2', 'm', 'b')]);
    const r = schedule(p);
    expect(r.tasks.get('m')!.start).toBe('2026-11-06');
    expect(r.tasks.get('b')!.start).toBe('2026-11-09');
  });

  it('un hito sin predecesoras al inicio no atrasa a su sucesora', () => {
    const p = project([task('m', 'Inicio', 0), task('a', 'A', 2)], [fs('d1', 'm', 'a')]);
    const r = schedule(p);
    expect(r.tasks.get('m')!.start).toBe('2026-11-02');
    expect(r.tasks.get('a')!.start).toBe('2026-11-02');
  });

  it('los hitos de la ruta crítica quedan marcados como críticos', () => {
    const p = project([task('a', 'A', 5), task('m', 'Hito', 0), task('b', 'B', 2)], [fs('d1', 'a', 'm'), fs('d2', 'm', 'b')]);
    const r = schedule(p);
    expect(r.tasks.get('m')!.isCritical).toBe(true);
    expect(r.tasks.get('m')!.slackDays).toBe(0);
  });
});

describe('restricciones', () => {
  const chain = (c: TaskConstraint) => project([task('a', 'A', 5), task('b', 'B', 3, 0, c)], [fs('d1', 'a', 'b')]);

  it('"no comenzar antes del" atrasa la tarea pero no la adelanta', () => {
    expect(schedule(chain({ type: 'SNET', date: '2026-11-16' })).tasks.get('b')!.start).toBe('2026-11-16');
    expect(schedule(chain({ type: 'SNET', date: '2026-11-03' })).tasks.get('b')!.start).toBe('2026-11-09');
  });

  it('"no finalizar antes del" corre el fin', () => {
    const b = schedule(chain({ type: 'FNET', date: '2026-11-20' })).tasks.get('b')!;
    expect(b).toMatchObject({ start: '2026-11-18', finish: '2026-11-20' });
  });

  it('"debe comenzar el" se respeta aunque choque con la predecesora y marca conflicto', () => {
    const b = schedule(chain({ type: 'MSO', date: '2026-11-04' })).tasks.get('b')!;
    expect(b.start).toBe('2026-11-04');
    expect(b.constraintConflict).toBe(true);
    const ok = schedule(chain({ type: 'MSO', date: '2026-11-12' })).tasks.get('b')!;
    expect(ok).toMatchObject({ start: '2026-11-12', constraintConflict: false });
  });

  it('"debe finalizar el" fija el fin', () => {
    const b = schedule(chain({ type: 'MFO', date: '2026-11-20' })).tasks.get('b')!;
    expect(b).toMatchObject({ start: '2026-11-18', finish: '2026-11-20' });
  });

  it('"no finalizar después del" genera holgura negativa cuando no alcanza', () => {
    const r = schedule(chain({ type: 'FNLT', date: '2026-11-10' }));
    const b = r.tasks.get('b')!;
    // B tendría que terminar el 11; la restricción la deja terminando el 10 y con conflicto.
    expect(b).toMatchObject({ finish: '2026-11-10', constraintConflict: true });
    // La predecesora debería haber terminado antes: holgura negativa.
    expect(r.tasks.get('a')!.slackDays).toBeLessThan(0);
    expect(r.tasks.get('a')!.isCritical).toBe(true);
  });

  it('"no comenzar después del" sin conflicto no mueve la tarea', () => {
    const b = schedule(chain({ type: 'SNLT', date: '2026-11-20' })).tasks.get('b')!;
    expect(b).toMatchObject({ start: '2026-11-09', constraintConflict: false });
  });

  it('"lo más tarde posible" corre la tarea hasta su sucesora', () => {
    const p = project(
      [task('a', 'A', 10), task('b', 'B', 2, 0, { type: 'ALAP', date: null }), task('c', 'C', 1)],
      [fs('d1', 'a', 'c'), fs('d2', 'b', 'c')],
    );
    const r = schedule(p);
    expect(r.tasks.get('c')!.start).toBe('2026-11-16');
    expect(r.tasks.get('b')).toMatchObject({ start: '2026-11-12', finish: '2026-11-13' });
  });

  it('informa comienzo y fin tardíos', () => {
    const p = project([task('a', 'A', 5), task('b', 'B', 2), task('c', 'C', 1)], [fs('d1', 'a', 'c'), fs('d2', 'b', 'c')]);
    const b = schedule(p).tasks.get('b')!;
    expect(b).toMatchObject({ lateStart: '2026-11-05', lateFinish: '2026-11-06', slackDays: 3 });
  });
});

describe('calendario', () => {
  const cal = new WorkCalendar(defaultCalendar());

  it('incluye los feriados de Chile 2027 con traslados', () => {
    expect(cal.isWorkingDay('2027-01-01')).toBe(false);
    expect(cal.isWorkingDay('2027-03-26')).toBe(false); // Viernes Santo
    expect(cal.isWorkingDay('2027-06-28')).toBe(false); // San Pedro y San Pablo trasladado a lunes
    expect(cal.isWorkingDay('2027-06-29')).toBe(true);
    expect(cal.isWorkingDay('2027-10-11')).toBe(false); // Encuentro de Dos Mundos trasladado
  });

  it('cruza fin de año saltando Navidad y Año Nuevo', () => {
    // jueves 24-12-2026 + 1 → lunes 28 (25 feriado, fin de semana)
    expect(cal.addWorkingDays('2026-12-24', 1)).toBe('2026-12-28');
    expect(cal.addWorkingDays('2026-12-31', 1)).toBe('2027-01-04');
  });

  it('calcula diferencias de días laborales con signo', () => {
    expect(cal.workingDaysDiff('2026-11-06', '2026-11-09')).toBe(1);
    expect(cal.workingDaysDiff('2026-11-09', '2026-11-06')).toBe(-1);
    expect(cal.workingDaysDiff('2026-11-09', '2026-11-09')).toBe(0);
  });

  it('respeta un calendario con sábado laboral', () => {
    const six = new WorkCalendar({ ...defaultCalendar(), workDays: [1, 2, 3, 4, 5, 6] });
    expect(six.addWorkingDays('2026-11-06', 1)).toBe('2026-11-07');
  });
});

describe('migración de archivos', () => {
  it('convierte el inicio manual del esquema 1 en "no comenzar antes del"', () => {
    const legacy = project([]);
    legacy.tasks = [{ id: 'a', name: 'A', level: 0, durationDays: 1, manualStart: '2026-11-10', percentComplete: 0, notes: '' } as unknown as Task];
    const t = normalizeProject(legacy).tasks[0];
    expect(t.constraint).toEqual({ type: 'SNET', date: '2026-11-10' });
    expect('manualStart' in t).toBe(false);
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

describe('vincular tareas desde la Gantt', () => {
  const p = project([task('s', 'Fase', 0, 0), task('a', 'A', 2, 1), task('b', 'B', 2, 1), task('c', 'C', 1, 0)], [fs('d1', 'a', 'b')]);

  it('acepta un vínculo nuevo válido', () => {
    expect(linkError(p, 'b', 'c')).toBeNull();
  });

  it('rechaza la misma tarea, los repetidos, los ciclos y resumen con subtarea', () => {
    expect(linkError(p, 'a', 'a')).toMatch(/sí misma/);
    expect(linkError(p, 'a', 'b')).toMatch(/ya están vinculadas/);
    expect(linkError(p, 'b', 'a')).toMatch(/ciclo/);
    expect(linkError(p, 's', 'a')).toMatch(/resumen/);
    expect(linkError(p, 'a', 's')).toMatch(/resumen/);
  });
});
