import { useMemo } from 'react';
import { WorkCalendar } from '../engine/calendar';
import { assignmentHours, computeResourceLoad, formatUnits } from '../engine/resources';
import type { ScheduleResult } from '../engine/schedule';
import { useProject } from '../store/project';

function fmtShort(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}-${m}`;
}

/** Vista de carga: horas por recurso y semana, con las semanas sobreasignadas en rojo. */
export function ResourceLoad({ result }: { result: ScheduleResult }) {
  const project = useProject((s) => s.project);
  const select = useProject((s) => s.select);
  const setView = useProject((s) => s.setView);
  const cal = useMemo(
    () => new WorkCalendar(project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0]),
    [project.calendars, project.calendarId],
  );
  const load = useMemo(() => computeResourceLoad(project, result, cal), [project, result, cal]);
  const work = project.resources.filter((r) => r.type === 'work');

  return (
    <div className="sheet">
      <div className="sheet-head">
        <strong>Carga por recurso · horas por semana</strong>
        {load.overallocatedIds.length > 0 ? (
          <span className="chip error">Rojo: semanas con más unidades que la capacidad del recurso</span>
        ) : (
          <span className="chip info">Ningún recurso supera su capacidad</span>
        )}
      </div>
      <div className="load-scroll">
        <table className="sheet-table load-table">
          <thead>
            <tr>
              <th className="sticky">Recurso</th>
              <th className="right">Total</th>
              {load.weeks.map((w) => (
                <th key={w} className="center">
                  {fmtShort(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {work.map((r) => {
              const rl = load.byResource.get(r.id)!;
              return (
                <tr key={r.id} className={rl.overallocated ? 'over' : ''}>
                  <td className="sticky" title={`Capacidad máxima ${formatUnits(r.maxUnits)}`}>
                    {rl.overallocated ? '⚠ ' : ''}
                    {r.name}
                  </td>
                  <td className="right">{Math.round(rl.totalHours)} h</td>
                  {load.weeks.map((w) => {
                    const wl = rl.weeks.get(w);
                    if (!wl) return <td key={w} className="center load-cell" />;
                    return (
                      <td
                        key={w}
                        className={`center load-cell ${wl.overallocated ? 'over' : 'busy'}`}
                        title={`Semana del ${fmtShort(w)}: ${Math.round(wl.hours)} h · máximo ${formatUnits(wl.peakUnits)} de ${formatUnits(r.maxUnits)}`}
                      >
                        {Math.round(wl.hours)} h
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {work.length === 0 && (
              <tr>
                <td colSpan={2 + load.weeks.length} className="muted center">
                  No hay recursos de trabajo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="sheet-sub">Tareas por recurso</h3>
      <table className="sheet-table">
        <thead>
          <tr>
            <th style={{ width: 200 }}>Recurso</th>
            <th>Tarea</th>
            <th style={{ width: 90 }} className="right">
              Unidades
            </th>
            <th style={{ width: 110 }}>Comienzo</th>
            <th style={{ width: 110 }}>Fin</th>
            <th style={{ width: 90 }} className="right">
              Trabajo
            </th>
          </tr>
        </thead>
        <tbody>
          {project.resources.flatMap((r) =>
            project.assignments
              .filter((a) => a.resourceId === r.id)
              .map((a) => {
                const t = result.tasks.get(a.taskId);
                const name = project.tasks.find((x) => x.id === a.taskId)?.name ?? '';
                if (!t) return null;
                return (
                  <tr
                    key={a.id}
                    className="clickable"
                    title="Clic para ver la tarea en la Gantt"
                    onClick={() => {
                      select(a.taskId);
                      setView('gantt');
                    }}
                  >
                    <td>{r.name}</td>
                    <td>
                      {t.row} · {name}
                    </td>
                    <td className="right">{formatUnits(a.units)}</td>
                    <td>{fmtShort(t.start)}</td>
                    <td>{fmtShort(t.finish)}</td>
                    <td className="right">{r.type === 'work' ? `${Math.round(assignmentHours(t, a.units))} h` : '—'}</td>
                  </tr>
                );
              }),
          )}
        </tbody>
      </table>
    </div>
  );
}
