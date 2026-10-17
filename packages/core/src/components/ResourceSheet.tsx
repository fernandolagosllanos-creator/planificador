import { useMemo } from 'react';
import { WorkCalendar } from '../engine/calendar';
import { computeResourceLoad } from '../engine/resources';
import type { ScheduleResult } from '../engine/schedule';
import type { ResourceType } from '../model/types';
import { RESOURCE_TYPE_LABEL_ES } from '../model/types';
import { useProject } from '../store/project';

/** Hoja de recursos: lista editable con capacidad, tasa y trabajo asignado. */
export function ResourceSheet({ result }: { result: ScheduleResult }) {
  const project = useProject((s) => s.project);
  const addResource = useProject((s) => s.addResource);
  const updateResource = useProject((s) => s.updateResource);
  const deleteResource = useProject((s) => s.deleteResource);
  const setError = useProject((s) => s.setError);

  const cal = useMemo(
    () => new WorkCalendar(project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0]),
    [project.calendars, project.calendarId],
  );
  const load = useMemo(() => computeResourceLoad(project, result, cal), [project, result, cal]);
  const assignmentsCount = (id: string) => project.assignments.filter((a) => a.resourceId === id).length;

  const num = (text: string, label: string): number | null => {
    const n = parseFloat(text.replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (Number.isNaN(n) || n < 0) {
      setError(`${label} debe ser un número mayor o igual que 0`);
      return null;
    }
    return n;
  };

  return (
    <div className="sheet">
      <div className="sheet-head">
        <strong>Hoja de recursos</strong>
        {load.overallocatedIds.length > 0 ? (
          <span className="chip warn">
            {load.overallocatedIds.length} {load.overallocatedIds.length === 1 ? 'recurso sobreasignado' : 'recursos sobreasignados'}
          </span>
        ) : (
          <span className="chip info">Sin sobreasignaciones</span>
        )}
        <span className="spacer" />
        <button className="primary" onClick={() => addResource()}>
          + Recurso
        </button>
      </div>
      <table className="sheet-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}></th>
            <th style={{ width: 220 }}>Nombre del recurso</th>
            <th style={{ width: 100 }}>Tipo</th>
            <th style={{ width: 80 }}>Iniciales</th>
            <th style={{ width: 110 }} className="right">
              Capacidad máx.
            </th>
            <th style={{ width: 130 }} className="right">
              Tasa estándar
            </th>
            <th style={{ width: 90 }} className="right">
              Trabajo
            </th>
            <th style={{ width: 100 }} className="right">
              Asignaciones
            </th>
            <th style={{ width: 70 }}></th>
          </tr>
        </thead>
        <tbody>
          {project.resources.map((r) => {
            const over = load.byResource.get(r.id)?.overallocated;
            return (
              <tr key={r.id} className={over ? 'over' : ''}>
                <td className="center" title={over ? 'Sobreasignado: en algún día supera su capacidad máxima' : undefined}>
                  {over ? '⚠' : ''}
                </td>
                <td>
                  <input value={r.name} onChange={(e) => updateResource(r.id, { name: e.target.value })} />
                </td>
                <td>
                  <select value={r.type} onChange={(e) => updateResource(r.id, { type: e.target.value as ResourceType })}>
                    {(Object.keys(RESOURCE_TYPE_LABEL_ES) as ResourceType[]).map((k) => (
                      <option key={k} value={k}>
                        {RESOURCE_TYPE_LABEL_ES[k]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input value={r.initials} onChange={(e) => updateResource(r.id, { initials: e.target.value })} />
                </td>
                <td className="right">
                  {r.type === 'work' ? (
                    <input
                      className="right"
                      defaultValue={`${Math.round(r.maxUnits * 100)}%`}
                      key={`${r.id}-${r.maxUnits}`}
                      onBlur={(e) => {
                        const n = num(e.target.value, 'La capacidad');
                        if (n !== null && n / 100 !== r.maxUnits) updateResource(r.id, { maxUnits: n / 100 });
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="right">
                  <input
                    className="right"
                    key={`${r.id}-${r.costPerHour}`}
                    defaultValue={`$ ${r.costPerHour.toLocaleString('es-CL')}${r.type === 'work' ? ' / h' : ''}`}
                    onBlur={(e) => {
                      const n = num(e.target.value.replace(/\./g, ''), 'La tasa');
                      if (n !== null && n !== r.costPerHour) updateResource(r.id, { costPerHour: n });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </td>
                <td className="right">{r.type === 'work' ? `${Math.round(load.byResource.get(r.id)?.totalHours ?? 0)} h` : '—'}</td>
                <td className="right">{assignmentsCount(r.id)}</td>
                <td className="center">
                  <button
                    className="link"
                    onClick={() => {
                      const n = assignmentsCount(r.id);
                      if (n === 0 || window.confirm(`"${r.name}" está asignado a ${n} ${n === 1 ? 'tarea' : 'tareas'}. ¿Quitarlo de todas y eliminarlo?`))
                        deleteResource(r.id);
                    }}
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            );
          })}
          {project.resources.length === 0 && (
            <tr>
              <td colSpan={9} className="muted center">
                Aún no hay recursos. Agrégalos aquí o escríbelos en la columna "Recursos" de la tabla de tareas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="muted small">
        Capacidad máxima: 100 % es una persona a tiempo completo; una cuadrilla de cuatro es 400 %. El trabajo se calcula con 8 horas por día laboral.
      </p>
    </div>
  );
}
