import { describe, expect, it } from 'vitest';
import type { JiraIssue, JiraStatus, JiraTransition } from './client';
import { buildColumns, filterIssues, transitionTo } from './board';

const issue = (key: string, status: string, category: string, assignee: string | null = null): JiraIssue => ({
  key,
  summary: `Resumen ${key}`,
  type: 'Tarea',
  status,
  statusCategory: category,
  assignee,
  dueDate: null,
  startDate: null,
});
const st = (id: string, name: string, category: string): JiraStatus => ({ id, name, category });

describe('tablero', () => {
  it('ordena las columnas por categoría y nombre y reparte las incidencias', () => {
    const statuses = [st('3', 'Hecho', 'done'), st('1', 'Por hacer', 'new'), st('2', 'En revisión', 'indeterminate'), st('4', 'En curso', 'indeterminate')];
    const issues = [issue('B1-1', 'En curso', 'indeterminate'), issue('B1-2', 'Hecho', 'done'), issue('B1-3', 'Bloqueada', 'indeterminate')];
    const cols = buildColumns(statuses, issues);
    expect(cols.map((c) => c.status.name)).toEqual(['Por hacer', 'Bloqueada', 'En curso', 'En revisión', 'Hecho']);
    expect(cols.find((c) => c.status.name === 'En curso')!.issues.map((i) => i.key)).toEqual(['B1-1']);
    // "Bloqueada" no estaba entre los estados del proyecto: se crea desde la incidencia.
    expect(cols.find((c) => c.status.name === 'Bloqueada')!.issues.length).toBe(1);
  });

  it('elige la transición por id del estado destino o por nombre', () => {
    const tr: JiraTransition[] = [
      { id: '11', name: 'Iniciar', to: st('4', 'En curso', 'indeterminate'), hasScreen: false },
      { id: '31', name: 'Terminar', to: st('3', 'Hecho', 'done'), hasScreen: true },
    ];
    expect(transitionTo(tr, st('3', 'Hecho', 'done'))?.id).toBe('31');
    expect(transitionTo(tr, st('', 'En curso', 'indeterminate'))?.id).toBe('11');
    expect(transitionTo(tr, st('9', 'En revisión', 'indeterminate'))).toBeNull();
  });

  it('filtra por tarea vinculada, responsable y texto', () => {
    const issues = [issue('B1-1', 'Por hacer', 'new', 'Carla'), issue('B1-2', 'Por hacer', 'new', 'Jorge'), issue('B1-3', 'Hecho', 'done')];
    const taskOf = new Map([
      ['B1-1', 't1'],
      ['B1-2', 't2'],
    ]);
    expect(filterIssues(issues, { task: 'linked', assignee: '', text: '' }, taskOf).map((i) => i.key)).toEqual(['B1-1', 'B1-2']);
    expect(filterIssues(issues, { task: 'unlinked', assignee: '', text: '' }, taskOf).map((i) => i.key)).toEqual(['B1-3']);
    expect(filterIssues(issues, { task: 't2', assignee: '', text: '' }, taskOf).map((i) => i.key)).toEqual(['B1-2']);
    expect(filterIssues(issues, { task: '', assignee: 'Carla', text: '' }, taskOf).map((i) => i.key)).toEqual(['B1-1']);
    expect(filterIssues(issues, { task: '', assignee: '', text: 'b1-3' }, taskOf).map((i) => i.key)).toEqual(['B1-3']);
  });
});
