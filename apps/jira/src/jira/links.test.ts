import { describe, expect, it } from 'vitest';
import type { JiraLink, Task } from '@planificador/core';
import type { JiraIssue } from './client';
import { addDependent, indexIssues, removeIssue, setBase, similarity, suggestLinks, summaryStatus, taskStatus, unlinkTask, usedKeys } from './links';

const issue = (key: string, summary: string, statusCategory = 'new'): JiraIssue => ({
  key,
  summary,
  type: 'Tarea',
  status: statusCategory === 'done' ? 'Hecho' : statusCategory === 'indeterminate' ? 'En curso' : 'Por hacer',
  statusCategory,
  assignee: null,
  dueDate: null,
  startDate: null,
});
const task = (id: string, name: string, level = 0): Task => ({
  id,
  name,
  level,
  durationDays: 1,
  constraint: { type: 'ASAP', date: null },
  percentComplete: 0,
  actualStart: null,
  actualFinish: null,
  notes: '',
});
const link = (links: JiraLink['links']): JiraLink => ({
  siteUrl: 'https://x.atlassian.net',
  projectKey: 'B1',
  projectName: 'B1',
  boardId: null,
  startDateField: null,
  dueDateField: 'duedate',
  links,
  lastSync: null,
});

describe('vínculos tarea ↔ incidencia', () => {
  it('fija la base y mueve una incidencia usada en otra tarea', () => {
    let links = setBase([], 't1', 'B1-1');
    links = addDependent(links, 't1', 'B1-2');
    expect(links).toEqual([{ taskId: 't1', base: 'B1-1', dependents: ['B1-2'] }]);
    // La misma incidencia pasa a ser base de t2: desaparece de t1.
    links = setBase(links, 't2', 'B1-2');
    expect(links.find((l) => l.taskId === 't1')).toEqual({ taskId: 't1', base: 'B1-1', dependents: [] });
    expect(links.find((l) => l.taskId === 't2')).toEqual({ taskId: 't2', base: 'B1-2', dependents: [] });
  });

  it('no deja la base también como dependiente y limpia tareas vacías', () => {
    let links = setBase([], 't1', 'B1-1');
    links = addDependent(links, 't1', 'B1-1');
    expect(links[0].dependents).toEqual([]);
    links = removeIssue(links, 'B1-1');
    expect(links).toEqual([]);
    links = addDependent([], 't1', 'B1-3');
    expect(links).toEqual([{ taskId: 't1', base: '', dependents: ['B1-3'] }]);
    expect(unlinkTask(links, 't1')).toEqual([]);
    expect(usedKeys(link(links)).get('B1-3')).toBe('t1');
  });

  it('calcula el estado y el avance desde Jira', () => {
    const issues = indexIssues([issue('B1-1', 'Base', 'indeterminate'), issue('B1-2', 'Dep hecha', 'done'), issue('B1-3', 'Dep pendiente')]);
    const l = link([{ taskId: 't1', base: 'B1-1', dependents: ['B1-2', 'B1-3', 'B1-9'] }]);
    const s = taskStatus(l, 't1', issues)!;
    expect(s.base?.key).toBe('B1-1');
    expect(s.dependents.map((d) => d.key)).toEqual(['B1-2', 'B1-3']);
    expect(s.missingDependents).toEqual(['B1-9']);
    expect(s.doneDependents).toBe(1);
    expect(s.progress).toBe(50);
    expect(taskStatus(l, 't2', issues)).toBeNull();
    const done = taskStatus(link([{ taskId: 't1', base: 'B1-2', dependents: [] }]), 't1', issues)!;
    expect(done.progress).toBe(100);
    const missing = taskStatus(link([{ taskId: 't1', base: 'B1-7', dependents: [] }]), 't1', issues)!;
    expect(missing.missingBase).toBe('B1-7');
  });

  it('resume las incidencias de los descendientes de un resumen', () => {
    const tasks = [task('s', 'Fase', 0), task('a', 'A', 1), task('b', 'B', 1), task('z', 'Otra fase', 0), task('c', 'C', 1)];
    const issues = indexIssues([issue('B1-1', 'a', 'done'), issue('B1-2', 'b'), issue('B1-3', 'c', 'done')]);
    const l = link([
      { taskId: 'a', base: 'B1-1', dependents: [] },
      { taskId: 'b', base: 'B1-2', dependents: [] },
      { taskId: 'c', base: 'B1-3', dependents: [] },
    ]);
    expect(summaryStatus(tasks, 0, l, issues)).toEqual({ done: 1, total: 2 });
    expect(summaryStatus(tasks, 3, l, issues)).toEqual({ done: 1, total: 1 });
  });
});

describe('sugerencias por nombre', () => {
  it('mide el parecido ignorando tildes, mayúsculas y palabras vacías', () => {
    expect(similarity('Preparación UAT', 'preparacion uat')).toBe(1);
    expect(similarity('Pruebas generales', 'Ejecutar ciclo de pruebas generales del portal')).toBe(0.9);
    expect(similarity('Revisión de seguridad', 'Seguridad: revisión ciclo 2')).toBeGreaterThanOrEqual(0.6);
    expect(similarity('Fundaciones', 'Permiso de edificación')).toBe(0);
  });

  it('propone una base por tarea hoja sin vincular, sin repetir incidencias', () => {
    const tasks = [task('s', 'Obras', 0), task('a', 'Preparación UAT', 1), task('b', 'Merge servicio 1', 1), task('c', 'Informe final', 1)];
    const issues = [issue('B1-1', 'Preparación UAT'), issue('B1-2', 'Preparacion UAT (ambiente)'), issue('B1-3', 'Merge rama servicio 1'), issue('B1-4', 'Checklist go live')];
    const out = suggestLinks(tasks, issues, link([{ taskId: 'c', base: 'B1-4', dependents: [] }]));
    expect(out.map((s) => [s.taskId, s.key])).toEqual([
      ['a', 'B1-1'],
      ['b', 'B1-3'],
    ]);
    // El resumen "Obras" nunca recibe sugerencia y las ya vinculadas tampoco.
    expect(out.some((s) => s.taskId === 's' || s.taskId === 'c')).toBe(false);
  });
});
