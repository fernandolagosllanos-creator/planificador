import { useState } from 'react';
import { FERIADOS_CHILE, withChileHolidays } from '../engine/calendar';
import type { Calendar } from '../model/types';
import { useProject } from '../store/project';

const DAYS: { n: number; label: string }[] = [
  { n: 1, label: 'Lunes' },
  { n: 2, label: 'Martes' },
  { n: 3, label: 'Miércoles' },
  { n: 4, label: 'Jueves' },
  { n: 5, label: 'Viernes' },
  { n: 6, label: 'Sábado' },
  { n: 0, label: 'Domingo' },
];

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** Editor del calendario laboral del proyecto: días laborables y feriados. */
export function CalendarDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project);
  const updateCalendar = useProject((s) => s.updateCalendar);
  const cal = project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0];
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');

  const save = (next: Calendar) => updateCalendar(next);
  const toggleDay = (n: number) =>
    save({ ...cal, workDays: cal.workDays.includes(n) ? cal.workDays.filter((d) => d !== n) : [...cal.workDays, n].sort() });
  const removeHoliday = (date: string) => save({ ...cal, holidays: cal.holidays.filter((h) => h.date !== date) });
  const addHoliday = () => {
    if (!newDate) return;
    const holidays = [...cal.holidays.filter((h) => h.date !== newDate), { date: newDate, name: newName.trim() || 'Feriado' }];
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    save({ ...cal, holidays });
    setNewDate('');
    setNewName('');
  };
  const missingChile = FERIADOS_CHILE.filter((h) => !cal.holidays.some((x) => x.date === h.date)).length;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Calendario laboral">
        <div className="modal-head">
          <strong>Calendario laboral · {cal.name}</strong>
          <button onClick={onClose}>Cerrar</button>
        </div>
        <div className="modal-body calendar-editor">
          <section>
            <h3>Semana laboral</h3>
            {DAYS.map((d) => (
              <label key={d.n} className="day-row">
                <input type="checkbox" checked={cal.workDays.includes(d.n)} onChange={() => toggleDay(d.n)} />
                <span>{d.label}</span>
                <span className="muted">{cal.workDays.includes(d.n) ? 'Laborable' : 'No laborable'}</span>
              </label>
            ))}
            <p className="muted small">Los cambios recalculan de inmediato las fechas de todas las tareas.</p>
          </section>
          <section className="grow">
            <div className="section-head">
              <h3>Feriados y días no laborables ({cal.holidays.length})</h3>
              <button
                className="primary"
                disabled={missingChile === 0}
                onClick={() => save(withChileHolidays(cal))}
                title="Agrega los feriados nacionales de Chile 2026 a 2028 que falten"
              >
                {missingChile ? `Cargar feriados de Chile (${missingChile})` : 'Feriados de Chile cargados'}
              </button>
            </div>
            <div className="holiday-add">
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              <input placeholder="Nombre" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addHoliday()} />
              <button onClick={addHoliday} disabled={!newDate}>
                + Agregar
              </button>
            </div>
            <div className="holiday-list">
              <table>
                <tbody>
                  {cal.holidays.map((h) => (
                    <tr key={h.date}>
                      <td>{fmt(h.date)}</td>
                      <td>{h.name}</td>
                      <td className="right">
                        <button className="link" onClick={() => removeHoliday(h.date)} title="Quitar este feriado">
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Los feriados de Chile son una sugerencia: revisa los trasladables y agrega los feriados por elecciones cuando se decreten.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
