import type { ScheduleResult } from '../engine/schedule';
import { computeWbs } from '../engine/schedule';
import type { ConstraintType } from '../model/types';
import { CONSTRAINT_LABEL_ES, CONSTRAINT_NEEDS_DATE } from '../model/types';
import { useState } from 'react';
import { assignmentHours, assignmentsOf, formatUnits } from '../engine/resources';
import { useProject } from '../store/project';
import { WorkCalendar } from '../engine/calendar';
import { plannedPercent, varianceOf } from '../engine/tracking';

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** Panel inferior con los datos de programación de la tarea seleccionada. */
export function TaskDetail({ result }: { result: ScheduleResult }) {
  const project = useProject((s) => s.project);
  const selectedId = useProject((s) => s.selectedId);
  const setConstraint = useProject((s) => s.setConstraint);
  const updateTask = useProject((s) => s.updateTask);
  const assign = useProject((s) => s.assign);
  const unassign = useProject((s) => s.unassign);
  const setAssignmentUnits = useProject((s) => s.setAssignmentUnits);
  const addResource = useProject((s) => s.addResource);
  const [pick, setPick] = useState('');
  const [units, setUnits] = useState('100');
  const setPercentComplete = useProject((s) => s.setPercentComplete);
  const cal = new WorkCalendar(project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0]);

  const task = project.tasks.find((t) => t.id === selectedId);
  const s = task ? result.tasks.get(task.id) : undefined;
  if (!task || !s) {
    return <div className="task-detail empty">Selecciona una tarea para ver su restricción, holgura y notas.</div>;
  }

  const c = task.constraint ?? { type: 'ASAP' as ConstraintType, date: null };
  const variance = varianceOf(s, project.baseline, cal);
  const statusDate = project.statusDate;
  const planned = statusDate && !s.isSummary ? plannedPercent(s, statusDate, cal) : null;
  const changeType = (type: ConstraintType) => {
    if (!CONSTRAINT_NEEDS_DATE[type]) setConstraint(task.id, { type, date: null });
    else {
      // Al elegir una restricción con fecha se propone la fecha actual de la tarea.
      const date = c.date ?? (type === 'FNET' || type === 'FNLT' || type === 'MFO' ? s.finish : s.start);
      setConstraint(task.id, { type, date });
    }
  };

  return (
    <div className="task-detail">
      <div className="detail-head">
        <strong>
          {s.row} · {computeWbs(project.tasks).get(task.id)} {task.name}
        </strong>
        {s.isCritical && <span className="chip error">Ruta crítica</span>}
        {!s.isSummary && (
          <span className={`chip ${s.slackDays < 0 ? 'error' : 'info'}`}>Holgura total {s.slackDays} d</span>
        )}
        {s.constraintConflict && (
          <span className="chip warn">La restricción choca con las predecesoras; se respeta la restricción</span>
        )}
        {variance && variance.finishVariance > 0 && <span className="chip warn">Termina {variance.finishVariance} d después de la línea base</span>}
        {variance && variance.finishVariance < 0 && <span className="chip info">Termina {-variance.finishVariance} d antes de la línea base</span>}
        {planned !== null && planned > s.percentComplete && (
          <span className="chip error">
            Atrasada: {s.percentComplete}% hecho, {planned}% planificado a la fecha de estado
          </span>
        )}
      </div>
      <div className="detail-fields">
        <Field label="Duración" value={s.isMilestone ? '0 d (hito)' : `${s.durationDays} d`} />
        <Field label="Comienzo" value={fmt(s.start)} />
        <Field label="Fin" value={fmt(s.finish)} />
        {!s.isSummary && <Field label="Comienzo tardío" value={fmt(s.lateStart)} />}
        {!s.isSummary && <Field label="Fin tardío" value={fmt(s.lateFinish)} />}
        <Field label="% Avance" value={`${s.percentComplete}%`} />
        {variance && <Field label="Comienzo LB" value={fmt(variance.baselineStart)} />}
        {variance && <Field label="Fin LB" value={fmt(variance.baselineFinish)} />}
        {variance && <Field label="Var. fin" value={`${variance.finishVariance > 0 ? '+' : ''}${variance.finishVariance} d`} />}
      </div>
      {!s.isSummary && (
        <div className="detail-fields">
          <label className="field">
            <span>% completado</span>
            <input
              type="number"
              min={0}
              max={100}
              value={s.percentComplete}
              onChange={(e) => {
                const n = Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10)));
                if (!Number.isNaN(n)) setPercentComplete(task.id, n);
              }}
            />
          </label>
          <label className="field">
            <span>Comienzo real</span>
            <input type="date" value={task.actualStart ?? ''} onChange={(e) => updateTask(task.id, { actualStart: e.target.value || null })} />
          </label>
          <label className="field">
            <span>Fin real</span>
            <input type="date" value={task.actualFinish ?? ''} onChange={(e) => updateTask(task.id, { actualFinish: e.target.value || null })} />
          </label>
          <button
            className="small-btn"
            onClick={() => setPercentComplete(task.id, 100)}
            disabled={s.percentComplete === 100}
            title="Marca la tarea como terminada en sus fechas programadas"
          >
            Marcar 100 %
          </button>
        </div>
      )}
      {!s.isSummary && (
        <div className="detail-fields">
          <label className="field">
            <span>Restricción</span>
            <select value={c.type} onChange={(e) => changeType(e.target.value as ConstraintType)}>
              {(Object.keys(CONSTRAINT_LABEL_ES) as ConstraintType[]).map((k) => (
                <option key={k} value={k}>
                  {CONSTRAINT_LABEL_ES[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Fecha de la restricción</span>
            <input
              type="date"
              disabled={!CONSTRAINT_NEEDS_DATE[c.type]}
              value={c.date ?? ''}
              onChange={(e) => e.target.value && setConstraint(task.id, { type: c.type, date: e.target.value })}
            />
          </label>
          <label className="field notes">
            <span>Notas</span>
            <input value={task.notes} onChange={(e) => updateTask(task.id, { notes: e.target.value })} placeholder="Sin notas" />
          </label>
        </div>
      )}
      {!s.isSummary && (
        <div className="detail-assign">
          <div className="field">
            <span>Recursos asignados</span>
            <table className="mini-table">
              <tbody>
                {assignmentsOf(project, task.id).map((a) => (
                  <tr key={a.id}>
                    <td>{a.resource.name}</td>
                    <td className="right">
                      <input
                        className="right units"
                        key={`${a.id}-${a.units}`}
                        defaultValue={formatUnits(a.units)}
                        title="Unidades asignadas (100 % = tiempo completo)"
                        onBlur={(e) => {
                          const n = parseFloat(e.target.value.replace(',', '.'));
                          if (n > 0 && n / 100 !== a.units) setAssignmentUnits(a.id, n / 100);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    </td>
                    <td className="right muted">{a.resource.type === 'work' ? `${Math.round(assignmentHours(s, a.units))} h` : ''}</td>
                    <td>
                      <button className="link" onClick={() => unassign(a.id)}>
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <select value={pick} onChange={(e) => setPick(e.target.value)}>
                      <option value="">Elegir recurso…</option>
                      {project.resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                      <option value="__new">+ Nuevo recurso…</option>
                    </select>
                  </td>
                  <td className="right">
                    <input className="right units" value={units} onChange={(e) => setUnits(e.target.value)} />
                  </td>
                  <td></td>
                  <td>
                    <button
                      disabled={!pick}
                      onClick={() => {
                        const n = parseFloat(units.replace(',', '.'));
                        if (!(n > 0)) return;
                        let id = pick;
                        if (pick === '__new') {
                          const name = window.prompt('Nombre del recurso nuevo');
                          if (!name?.trim()) return;
                          id = addResource({ name: name.trim() });
                        }
                        assign(task.id, id, n / 100);
                        setPick('');
                      }}
                    >
                      Asignar
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="value">{value}</div>
    </div>
  );
}
