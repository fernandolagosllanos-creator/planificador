import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkCalendar } from '../engine/calendar';
import { varianceOf } from '../engine/tracking';
import { visibleTaskIds } from '../engine/outline';
import type { ScheduleResult } from '../engine/schedule';
import type { Task } from '../model/types';
import { formatResourceNames } from '../engine/resources';
import { computeWbs, formatPredecessors } from '../engine/schedule';
import { CONSTRAINT_LABEL_ES } from '../model/types';
import { useProject } from '../store/project';
import { ROW_HEIGHT } from './layout';

interface Props {
  result: ScheduleResult;
}

const BASE_COLUMNS = [
  { key: 'row', label: '', width: 36 },
  { key: 'ind', label: '', width: 24 },
  { key: 'wbs', label: 'EDT', width: 56 },
  { key: 'name', label: 'Nombre de tarea', width: 260 },
  { key: 'duration', label: 'Duración', width: 80 },
  { key: 'start', label: 'Comienzo', width: 104 },
  { key: 'finish', label: 'Fin', width: 104 },
  { key: 'preds', label: 'Predecesoras', width: 120 },
  { key: 'pct', label: '% comp.', width: 70 },
  { key: 'resources', label: 'Recursos', width: 160 },
] as const;

const BASELINE_COLUMNS = [
  { key: 'bstart', label: 'Comienzo LB', width: 100 },
  { key: 'bfinish', label: 'Fin LB', width: 100 },
  { key: 'varfin', label: 'Var. fin', width: 64 },
] as const;

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function parseUserDate(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  return null;
}

export function TaskTable({ result }: Props) {
  const project = useProject((s) => s.project);
  const selectedId = useProject((s) => s.selectedId);
  const select = useProject((s) => s.select);
  const updateTask = useProject((s) => s.updateTask);
  const setPredecessors = useProject((s) => s.setPredecessors);
  const setConstraint = useProject((s) => s.setConstraint);
  const setResourceNames = useProject((s) => s.setResourceNames);
  const setPercentComplete = useProject((s) => s.setPercentComplete);
  const toggleCollapse = useProject((s) => s.toggleCollapse);
  const moveTaskTo = useProject((s) => s.moveTaskTo);
  const visible = visibleTaskIds(project.tasks);
  const visibleTasks = project.tasks.filter((t) => visible.has(t.id));

  // Arrastre de filas con el mouse: se toma la fila por su número y se suelta entre dos filas.
  const [rowDrag, setRowDrag] = useState<{ id: string; before: string | null | undefined } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const startRowDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    select(id);
    let current: string | null | undefined = undefined;
    const onMove = (ev: PointerEvent) => {
      const tr = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('tr[data-id]') as HTMLElement | null;
      if (!tr) return;
      const rect = tr.getBoundingClientRect();
      const overId = tr.dataset.id!;
      if (ev.clientY < rect.top + rect.height / 2) current = overId;
      else {
        const idx = visibleTasks.findIndex((t) => t.id === overId);
        current = idx + 1 < visibleTasks.length ? visibleTasks[idx + 1].id : null;
      }
      setRowDrag({ id, before: current });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setRowDrag(null);
      if (current !== undefined && current !== id) moveTaskTo(id, current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    setRowDrag({ id, before: undefined });
  };
  const columns = project.baseline ? [...BASE_COLUMNS, ...BASELINE_COLUMNS] : [...BASE_COLUMNS];
  const tableWidth = columns.reduce((acc, c) => acc + c.width, 0);
  const cal = useMemo(
    () => new WorkCalendar(project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0]),
    [project.calendars, project.calendarId],
  );
  const setError = useProject((s) => s.setError);
  const wbs = computeWbs(project.tasks);

  const [editing, setEditing] = useState<{ id: string; col: string } | null>(null);

  return (
    <table className={`task-table ${rowDrag ? 'row-dragging' : ''}`} style={{ width: tableWidth }} ref={tableRef}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: c.width }} />
        ))}
      </colgroup>
      <thead>
        <tr style={{ height: ROW_HEIGHT * 2 }}>
          {columns.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visibleTasks.map((t) => {
          const s = result.tasks.get(t.id)!;
          const i = s.row - 1;
          const isSel = selectedId === t.id;
          const cls = [
            isSel ? 'selected' : '',
            s.isSummary ? 'summary' : '',
            result.cycle.includes(t.id) ? 'cycle' : '',
            rowDrag?.before === t.id ? 'drop-before' : '',
            rowDrag && rowDrag.before === null && t.id === visibleTasks[visibleTasks.length - 1].id ? 'drop-after' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const cell = (col: string, value: string, commit: (v: string) => void, opts: { editable?: boolean; align?: string } = {}) => {
            const editable = opts.editable ?? true;
            const isEditing = editing?.id === t.id && editing.col === col;
            return (
              <td
                className={`${isEditing ? 'editing' : ''} ${opts.align ?? ''}`}
                onDoubleClick={() => editable && setEditing({ id: t.id, col })}
                onClick={() => select(t.id)}
              >
                {isEditing ? (
                  <CellEditor
                    value={value}
                    onCommit={(v) => {
                      setEditing(null);
                      if (v !== value) commit(v);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <span style={col === 'name' ? { paddingLeft: 4 + t.level * 16 } : undefined}>
                    {col === 'name' && s.isSummary && (
                      <button
                        className="collapse"
                        title={t.collapsed ? 'Expandir subtareas' : 'Contraer subtareas'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(t.id);
                        }}
                      >
                        {t.collapsed ? '▸' : '▾'}
                      </button>
                    )}
                    {value}
                  </span>
                )}
              </td>
            );
          };
          return (
            <tr key={t.id} className={cls} style={{ height: ROW_HEIGHT }} data-row={i + 1} data-id={t.id}>
              <td className="row-num" onClick={() => select(t.id)} onPointerDown={(e) => startRowDrag(e, t.id)} title="Arrastra para mover la fila">
                {i + 1}
              </td>
              <td className="indicator" onClick={() => select(t.id)} title={indicatorTitle(t.constraint, s.constraintConflict)}>
                {s.constraintConflict ? '⚠' : t.constraint && t.constraint.date ? '📌' : ''}
              </td>
              <td className="wbs" onClick={() => select(t.id)}>
                {wbs.get(t.id)}
              </td>
              {cell('name', t.name, (v) => updateTask(t.id, { name: v }))}
              {cell(
                'duration',
                s.isSummary ? `${s.durationDays} d` : s.isMilestone ? '0 d (hito)' : `${s.durationDays} d`,
                (v) => {
                  const n = parseFloat(v.replace(',', '.'));
                  if (Number.isNaN(n) || n < 0) setError('La duración debe ser un número de días (0 para un hito)');
                  else updateTask(t.id, { durationDays: Math.round(n) });
                },
                { editable: !s.isSummary, align: 'right' },
              )}
              {cell(
                'start',
                fmt(s.start),
                (v) => {
                  const iso = parseUserDate(v);
                  if (!iso) setError('Fecha no válida. Usa el formato dd-mm-aaaa');
                  // Como en Project: escribir un comienzo fija "No comenzar antes del".
                  else setConstraint(t.id, { type: 'SNET', date: iso });
                },
                { editable: !s.isSummary },
              )}
              {cell(
                'finish',
                fmt(s.finish),
                (v) => {
                  const iso = parseUserDate(v);
                  if (!iso) setError('Fecha no válida. Usa el formato dd-mm-aaaa');
                  // Escribir un fin fija "No finalizar antes del".
                  else setConstraint(t.id, { type: 'FNET', date: iso });
                },
                { editable: !s.isSummary },
              )}
              {cell('preds', formatPredecessors(project, t.id), (v) => setPredecessors(t.id, v))}
              {cell(
                'pct',
                `${s.percentComplete}%`,
                (v) => {
                  const n = parseInt(v, 10);
                  if (Number.isNaN(n) || n < 0 || n > 100) setError('El avance debe estar entre 0 y 100');
                  else setPercentComplete(t.id, n);
                },
                { editable: !s.isSummary, align: 'right' },
              )}
              {cell('resources', formatResourceNames(project, t.id), (v) => setResourceNames(t.id, v), { editable: !s.isSummary })}
              {project.baseline &&
                (() => {
                  const v = varianceOf(s, project.baseline, cal);
                  const vf = v ? v.finishVariance : null;
                  return (
                    <>
                      <td className="muted">{v ? fmt(v.baselineStart) : '—'}</td>
                      <td className="muted">{v ? fmt(v.baselineFinish) : '—'}</td>
                      <td className={`right ${vf !== null && vf > 0 ? 'late' : ''}`}>{vf === null ? '—' : `${vf > 0 ? '+' : ''}${vf} d`}</td>
                    </>
                  );
                })()}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function indicatorTitle(c: Task['constraint'] | undefined, conflict: boolean): string | undefined {
  if (!c || !c.date) return undefined;
  const text = `${CONSTRAINT_LABEL_ES[c.type]} ${fmt(c.date)}`;
  return conflict ? `${text}. La restricción no se puede cumplir con las predecesoras actuales.` : text;
}

function CellEditor({ value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(value);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(v);
        else if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
    />
  );
}
