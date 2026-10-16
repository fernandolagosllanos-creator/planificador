import type { ScheduleResult } from '../engine/schedule';
import { computeWbs } from '../engine/schedule';
import type { ConstraintType } from '../model/types';
import { CONSTRAINT_LABEL_ES, CONSTRAINT_NEEDS_DATE } from '../model/types';
import { useProject } from '../store/project';

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

  const task = project.tasks.find((t) => t.id === selectedId);
  const s = task ? result.tasks.get(task.id) : undefined;
  if (!task || !s) {
    return <div className="task-detail empty">Selecciona una tarea para ver su restricción, holgura y notas.</div>;
  }

  const c = task.constraint ?? { type: 'ASAP' as ConstraintType, date: null };
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
      </div>
      <div className="detail-fields">
        <Field label="Duración" value={s.isMilestone ? '0 d (hito)' : `${s.durationDays} d`} />
        <Field label="Comienzo" value={fmt(s.start)} />
        <Field label="Fin" value={fmt(s.finish)} />
        {!s.isSummary && <Field label="Comienzo tardío" value={fmt(s.lateStart)} />}
        {!s.isSummary && <Field label="Fin tardío" value={fmt(s.lateFinish)} />}
        <Field label="% Avance" value={`${s.percentComplete}%`} />
      </div>
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
