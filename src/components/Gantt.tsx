import { useMemo } from 'react';
import type { ScheduleResult } from '../engine/schedule';
import { addDays, diffDays, parseDate, today } from '../engine/calendar';
import { WorkCalendar } from '../engine/calendar';
import { useProject, type Zoom } from '../store/project';
import { HEADER_HEIGHT, ROW_HEIGHT } from './layout';

interface Props {
  result: ScheduleResult;
}

const PX_PER_DAY: Record<Zoom, number> = { day: 32, week: 10, month: 3.2 };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export function Gantt({ result }: Props) {
  const project = useProject((s) => s.project);
  const zoom = useProject((s) => s.zoom);
  const selectedId = useProject((s) => s.selectedId);
  const select = useProject((s) => s.select);
  const pxPerDay = PX_PER_DAY[zoom];

  const cal = useMemo(
    () => new WorkCalendar(project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0]),
    [project.calendars, project.calendarId],
  );

  // Rango visible: una semana antes del inicio y dos después del fin.
  const rangeStart = addDays(result.projectStart < project.start ? result.projectStart : project.start, -7);
  const todayIso = today();
  let rangeEnd = addDays(result.projectFinish, 14);
  if (todayIso > rangeEnd) rangeEnd = addDays(todayIso, 7);
  if (todayIso < rangeStart) {
    /* hoy queda fuera a la izquierda, no importa */
  }
  const totalDays = diffDays(rangeStart, rangeEnd) + 1;
  const width = Math.ceil(totalDays * pxPerDay);
  const height = HEADER_HEIGHT + result.order.length * ROW_HEIGHT;

  const x = (iso: string) => diffDays(rangeStart, iso) * pxPerDay;
  const xEnd = (iso: string) => x(iso) + pxPerDay; // fin del día, inclusive

  // Encabezado: meses arriba; abajo días (zoom día), semanas (zoom semana) o nada (mes).
  const months: { label: string; x0: number; x1: number }[] = [];
  const lower: { label: string; x0: number; x1: number }[] = [];
  const nonWorking: number[] = [];
  {
    let d = rangeStart;
    let curMonth = -1;
    while (d <= rangeEnd) {
      const dt = parseDate(d);
      const m = dt.getUTCMonth();
      if (m !== curMonth) {
        months.push({ label: `${MESES[m]} ${dt.getUTCFullYear()}`, x0: x(d), x1: x(d) });
        curMonth = m;
      }
      months[months.length - 1].x1 = xEnd(d);
      if (zoom === 'day') lower.push({ label: `${DIAS[dt.getUTCDay()]}${dt.getUTCDate()}`, x0: x(d), x1: xEnd(d) });
      if (zoom === 'week' && dt.getUTCDay() === 1) lower.push({ label: `${dt.getUTCDate()}`, x0: x(d), x1: x(d) + 7 * pxPerDay });
      if (zoom !== 'month' && !cal.isWorkingDay(d)) nonWorking.push(x(d));
      d = addDays(d, 1);
    }
  }

  const rowY = (row: number) => HEADER_HEIGHT + (row - 1) * ROW_HEIGHT;
  const byId = result.tasks;

  // Flechas de dependencias (dibujadas de hoja a hoja según las dependencias declaradas).
  const arrows = project.dependencies
    .map((d) => {
      const a = byId.get(d.from);
      const b = byId.get(d.to);
      if (!a || !b) return null;
      const ay = rowY(a.row) + ROW_HEIGHT / 2;
      const by = rowY(b.row) + ROW_HEIGHT / 2;
      const fromX = d.type === 'SS' || d.type === 'SF' ? x(a.start) : xEnd(a.finish);
      const toX = d.type === 'FF' || d.type === 'SF' ? xEnd(b.finish) : x(b.start);
      const dir = by > ay ? 1 : -1;
      const half = (ROW_HEIGHT / 2) * dir;
      let path: string;
      if (d.type === 'FS' || d.type === 'SS') {
        if (toX >= fromX + 8) {
          path = `M${fromX},${ay} H${toX - 6} V${by} H${toX - 1}`;
        } else {
          // La sucesora comienza antes (adelanto): rodear por abajo.
          path = `M${fromX},${ay} H${fromX + 6} V${ay + half} H${toX - 8} V${by} H${toX - 1}`;
        }
        return { key: d.id, path, headX: toX, headY: by, left: true, critical: a.isCritical && b.isCritical };
      }
      // FF / SF: la flecha llega al fin de la sucesora por la derecha.
      path = `M${fromX},${ay} H${Math.max(fromX, toX) + 8} V${by} H${toX + 1}`;
      return { key: d.id, path, headX: toX, headY: by, left: false, critical: a.isCritical && b.isCritical };
    })
    .filter(Boolean) as { key: string; path: string; headX: number; headY: number; left: boolean; critical: boolean }[];

  return (
    <svg className="gantt" width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <pattern id="summary-hatch" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="#334155" />
        </pattern>
      </defs>
      {/* Fondo de filas */}
      {result.order.map((t, i) => (
        <rect
          key={t.id}
          x={0}
          y={rowY(t.row)}
          width={width}
          height={ROW_HEIGHT}
          className={`gantt-row ${i % 2 ? 'odd' : ''} ${t.id === selectedId ? 'selected' : ''}`}
          onClick={() => select(t.id)}
        />
      ))}
      {/* Días no laborables */}
      {nonWorking.map((nx) => (
        <rect key={nx} x={nx} y={HEADER_HEIGHT} width={pxPerDay} height={height - HEADER_HEIGHT} className="gantt-nonworking" />
      ))}
      {/* Encabezado */}
      <rect x={0} y={0} width={width} height={HEADER_HEIGHT} className="gantt-header-bg" />
      {months.map((m) => (
        <g key={m.label + m.x0}>
          <line x1={m.x0} y1={0} x2={m.x0} y2={height} className="gantt-grid-month" />
          <text x={m.x0 + 4} y={ROW_HEIGHT - 9} className="gantt-header-text">
            {m.label}
          </text>
        </g>
      ))}
      {lower.map((l) => (
        <g key={l.x0}>
          <line x1={l.x0} y1={ROW_HEIGHT} x2={l.x0} y2={height} className="gantt-grid" />
          {l.x1 - l.x0 > 14 && (
            <text x={l.x0 + (l.x1 - l.x0) / 2} y={HEADER_HEIGHT - 9} textAnchor="middle" className="gantt-header-text small">
              {l.label}
            </text>
          )}
        </g>
      ))}
      <line x1={0} y1={HEADER_HEIGHT} x2={width} y2={HEADER_HEIGHT} className="gantt-grid-month" />

      {/* Flechas */}
      {arrows.map((a) => (
        <g key={a.key} className={`gantt-arrow ${a.critical ? 'critical' : ''}`}>
          <path d={a.path} fill="none" />
          <polygon
            points={
              a.left
                ? `${a.headX},${a.headY} ${a.headX - 6},${a.headY - 4} ${a.headX - 6},${a.headY + 4}`
                : `${a.headX},${a.headY} ${a.headX + 6},${a.headY - 4} ${a.headX + 6},${a.headY + 4}`
            }
          />
        </g>
      ))}

      {/* Barras */}
      {result.order.map((t) => {
        const y = rowY(t.row);
        const x0 = x(t.start);
        const x1 = xEnd(t.finish);
        const w = Math.max(x1 - x0, 2);
        const label = project.tasks.find((p) => p.id === t.id)?.name ?? '';
        if (t.isMilestone) {
          const cx = x0 + pxPerDay / 2;
          const cy = y + ROW_HEIGHT / 2;
          const r = 7;
          return (
            <g key={t.id} onClick={() => select(t.id)}>
              <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} className="gantt-milestone" />
              <text x={cx + r + 4} y={cy + 4} className="gantt-label">
                {label} ({fmtShort(t.start)})
              </text>
            </g>
          );
        }
        if (t.isSummary) {
          const h = 6;
          const top = y + 7;
          return (
            <g key={t.id} onClick={() => select(t.id)} className="gantt-summary">
              <rect x={x0} y={top} width={w} height={h} />
              <polygon points={`${x0},${top + h} ${x0 + 6},${top + h} ${x0},${top + h + 6}`} />
              <polygon points={`${x1},${top + h} ${x1 - 6},${top + h} ${x1},${top + h + 6}`} />
              <text x={x1 + 6} y={y + ROW_HEIGHT / 2 + 4} className="gantt-label">
                {label}
              </text>
            </g>
          );
        }
        const barH = 14;
        const top = y + (ROW_HEIGHT - barH) / 2;
        return (
          <g key={t.id} onClick={() => select(t.id)} className={`gantt-bar ${t.isCritical ? 'critical' : ''}`}>
            <rect x={x0} y={top} width={w} height={barH} rx={2} className="bar" />
            {t.percentComplete > 0 && <rect x={x0} y={top + 4} width={(w * t.percentComplete) / 100} height={barH - 8} className="progress" />}
            <text x={x1 + 6} y={y + ROW_HEIGHT / 2 + 4} className="gantt-label">
              {label}
            </text>
          </g>
        );
      })}

      {/* Línea de hoy */}
      {todayIso >= rangeStart && todayIso <= rangeEnd && (
        <g className="gantt-today">
          <line x1={x(todayIso) + pxPerDay / 2} y1={HEADER_HEIGHT} x2={x(todayIso) + pxPerDay / 2} y2={height} />
          <text x={x(todayIso) + pxPerDay / 2 + 3} y={HEADER_HEIGHT + 12}>
            hoy
          </text>
        </g>
      )}
    </svg>
  );
}

function fmtShort(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}-${m}`;
}
