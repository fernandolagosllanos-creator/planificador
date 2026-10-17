import { describe, expect, it } from 'vitest';
import type { Project, Task } from '../model/types';
import { defaultCalendar } from './calendar';
import { groupTasks, linkedComponent, moveTaskBefore, ungroupTask, visibleTaskIds } from './outline';
import { computeWbs } from './schedule';

function task(id: string, level = 0, extra: Partial<Task> = {}): Task {
  return { id, name: id.toUpperCase(), level, durationDays: 1, constraint: { type: 'ASAP', date: null }, percentComplete: 0, actualStart: null, actualFinish: null, notes: '', ...extra };
}

function project(tasks: Task[], deps: Project['dependencies'] = []): Project {
  return { id: 'p', name: 'P', start: '2026-11-02', statusDate: null, baseline: null, calendarId: 'cal-std', calendars: [defaultCalendar()], tasks, dependencies: deps, resources: [], assignments: [] };
}
const fs = (from: string, to: string) => ({ id: from + to, from, to, type: 'FS' as const, lagDays: 0 });
const names = (tasks: Task[]) => tasks.map((t) => `${t.level}:${t.id}`);

describe('agrupar tareas vinculadas', () => {
  it('encuentra la cadena de tareas vinculadas entre hermanas', () => {
    const p = project([task('a'), task('b'), task('c'), task('d'), task('s'), task('x', 1)], [fs('a', 'b'), fs('b', 'c'), fs('d', 's'), fs('c', 'x')]);
    expect(linkedComponent(p, 'b')).toEqual(['a', 'b', 'c']);
    // x está en otro nivel: no entra aunque esté vinculada.
    expect(linkedComponent(p, 'c')).toEqual(['a', 'b', 'c']);
    expect(linkedComponent(p, 's')).toEqual(['d', 's']);
  });

  it('agrupa bajo un resumen nuevo y deja las demás tareas en su lugar', () => {
    const p = project([task('a'), task('b'), task('c'), task('d')], [fs('a', 'c')]);
    const { tasks, summaryId } = groupTasks(p, ['a', 'c'], 'Fase');
    expect(names(tasks)).toEqual([`0:${summaryId}`, '1:a', '1:c', '0:b', '0:d']);
    expect(computeWbs(tasks).get('c')).toBe('1.2');
  });

  it('arrastra las subtareas de un resumen agrupado', () => {
    const p = project([task('s'), task('s1', 1), task('b'), task('c')]);
    const { tasks } = groupTasks(p, ['s', 'c']);
    expect(names(tasks).slice(1)).toEqual(['1:s', '2:s1', '1:c', '0:b']);
  });

  it('rechaza agrupar tareas de distinto resumen', () => {
    const p = project([task('s'), task('s1', 1), task('b')]);
    expect(() => groupTasks(p, ['s1', 'b'])).toThrow(/mismo nivel/);
  });

  it('desagrupa subiendo las subtareas un nivel', () => {
    const p = project([task('s'), task('a', 1), task('b', 1), task('c')]);
    expect(names(ungroupTask(p, 's'))).toEqual(['0:a', '0:b', '0:c']);
    expect(() => ungroupTask(p, 'c')).toThrow(/resumen/);
  });
});

describe('mover filas', () => {
  it('mueve una tarea antes de otra y adopta su nivel', () => {
    const p = project([task('s'), task('a', 1), task('b', 1), task('c')]);
    expect(names(moveTaskBefore(p, 'c', 'b'))).toEqual(['0:s', '1:a', '1:c', '1:b']);
  });

  it('mueve al final con el nivel de la última fila', () => {
    const p = project([task('a'), task('s'), task('s1', 1)]);
    expect(names(moveTaskBefore(p, 'a', null))).toEqual(['0:s', '1:s1', '1:a']);
  });

  it('mueve un resumen con sus subtareas y no lo deja dentro de sí mismo', () => {
    const p = project([task('s'), task('s1', 1), task('b')]);
    expect(names(moveTaskBefore(p, 's', null))).toEqual(['0:b', '0:s', '1:s1']);
    expect(moveTaskBefore(p, 's', 's1')).toBe(p.tasks);
  });
});

describe('contraer resúmenes', () => {
  it('oculta los descendientes de un resumen contraído', () => {
    const tasks = [task('s', 0, { collapsed: true }), task('a', 1), task('t', 1, { collapsed: true }), task('b', 2), task('c'), task('u'), task('u1', 1)];
    expect([...visibleTaskIds(tasks)]).toEqual(['s', 'c', 'u', 'u1']);
  });
});
