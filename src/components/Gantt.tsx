import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleResult } from '../engine/schedule';
import { addDays, diffDays, parseDate, today } from '../engine/calendar';
import { WorkCalendar } from '../engine/calendar';
import { formatResourceNames } from '../engine/resources';
import { useProject, type Zoom } from '../store/project';
import { HEADER_HEIGHT, ROW_HEIGHT } from './layout';

interface Props {
  result: ScheduleResult;
}

const PX_PER_DAY: Record<Zoom, number> = { day: 32, week: 10, month: 3.2 };
const ZOOMS: Zoom[] = ['day', 'week', 'month'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const BAR_H = 14;

/** Arrastre en curso: mover una barra, alargarla o dibujar un vínculo. */
type Drag =
  | { kind: 'move' | 'resize'; id: string; originX: number; dx: number }
  | { kind: 'link'; id: string; fromX: number; fromY: number; px: number; py: number; overId: string | null };

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function fmtShort(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}-${m}`;
}

export function Gantt({ result }: Props) {
  const project = useProject((s) => s.project);
  const zoom = useProject((s) => s.zoom);
  const setZoom = useProject((s) => s.setZoom);
  const scrollTo = useProject((s) => s.scrollTo);
  const selectedId = useProject((s) => s.selectedId);
  const select = useProject((s) => s.select);
  const setConstraint = useProject((s) => s.setConstraint);
  const updateTask = useProject((s) => s.updateTask);
  const addDependency = useProject((s) => s.addDependency);
  const removeDependency = useProject((s) => s.removeDependency);
  const pxPerDay = PX_PER_DAY[zoom];
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  // El arrastre también vive en un ref: los eventos de puntero pueden llegar antes de que React vuelva a renderizar.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const cal = useMemo(
    () => new WorkCalendar(project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0]),
    [project.calendars, project.calendarId],
  );

  // Rango visible: una semana antes del inicio y dos después del fin.
  const rangeStart = addDays(result.projectStart < project.start ? result.projectStart : project.start, -7);
  const todayIso = today();
  let rangeEnd = addDays(result.projectFinish, 14);
  if (todayIso > rangeEnd) rangeEnd = addDays(todayIso, 7);
  const totalDays = diffDays(rangeStart, rangeEnd) + 1;
  const width = Math.ceil(totalDays * pxPerDay);
  const height = HEADER_HEIGHT + result.order.length * ROW_HEIGHT;

  const x = (iso: string) => diffDays(rangeStart, iso) * pxPerDay;
  const xEnd = (iso: string) => x(iso) + pxPerDay; // fin del día, inclusive

  // Desplazar hasta una fecha pedida desde la barra de herramientas.
  useEffect(() => {
    if (!scrollTo) return;
    const pane = svgRef.current?.parentElement;
    if (!pane) return;
    pane.scrollTo({ left: Math.max(0, x(scrollTo.date) - pane.clientWidth / 3), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo?.n]);

  // Ctrl + rueda cambia el zoom (hay que registrarlo sin "passive" para poder anular el scroll).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const i = ZOOMS.indexOf(useProject.getState().zoom);
      const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + (e.deltaY > 0 ? 1 : -1)))];
      setZoom(next);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [setZoom]);

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
  const nameOf = (id: string) => project.tasks.find((p) => p.id === id)?.name ?? '';
  const resourcesOf = (id: string) => formatResourceNames(project, id).replace(/;/g, ', ');

  // ---------------------------------------------------------------------------
  // Arrastre
  // ---------------------------------------------------------------------------
  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const daysOf = (dx: number) => Math.round(dx / pxPerDay);

  /** Fechas que tendría la tarea si se soltara el arrastre ahora. */
  const preview = (t: ScheduleResult['order'][number], d: Drag) => {
    if (d.kind === 'move') {
      const days = daysOf(d.dx);
      if (days === 0) return null;
      const start = days > 0 ? cal.nextWorkingDay(addDays(t.start, days)) : cal.prevWorkingDay(addDays(t.start, days));
      const finish = t.isMilestone ? start : cal.addWorkingDays(start, Math.max(t.durationDays - 1, 0));
      return { start, finish, durationDays: t.durationDays };
    }
    if (d.kind === 'resize') {
      const days = daysOf(d.dx);
      if (days === 0) return null;
      const finish = cal.prevWorkingDay(addDays(t.finish, days));
      const durationDays = Math.max(1, cal.workingDaysBetween(t.start, finish));
      return { start: t.start, finish: cal.addWorkingDays(t.start, durationDays - 1), durationDays };
    }
    return null;
  };

  /** Captura el puntero para seguir recibiendo eventos aunque salga de la barra. */
  const capture = (e: React.PointerEvent<SVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* algunos entornos no admiten captura; el arrastre sigue funcionando dentro del SVG */
    }
  };

  const startDrag = (e: React.PointerEvent<SVGElement>, id: string, kind: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(id);
    capture(e);
    setDrag({ kind, id, originX: e.clientX, dx: 0 });
  };

  const startLink = (e: React.PointerEvent<SVGElement>, id: string, fromX: number, fromY: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(id);
    capture(e);
    const { px, py } = svgPoint(e);
    setDrag({ kind: 'link', id, fromX, fromY, px, py, overId: null });
  };

  const onPointerMove = (e: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'link') {
      const { px, py } = svgPoint(e);
      const row = Math.floor((py - HEADER_HEIGHT) / ROW_HEIGHT);
      const over = row >= 0 && row < result.order.length ? result.order[row] : null;
      setDrag({ ...drag, px, py, overId: over && over.id !== drag.id && !over.isSummary ? over.id : null });
    } else {
      setDrag({ ...drag, dx: e.clientX - drag.originX });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    setDrag(null);
    const t = byId.get(drag.id);
    if (!t) return;
    if (drag.kind === 'link') {
      if (drag.overId) addDependency(drag.id, drag.overId);
      return;
    }
    const p = preview(t, drag);
    if (!p) return;
    // Como en Project: mover una barra fija "No comenzar antes del"; alargarla cambia la duración.
    if (drag.kind === 'move') setConstraint(t.id, { type: 'SNET', date: p.start });
    else updateTask(t.id, { durationDays: p.durationDays });
  };

  // ---------------------------------------------------------------------------
  // Flechas de dependencias (dibujadas de hoja a hoja según las dependencias declaradas).
  // ---------------------------------------------------------------------------
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
      let left = true;
      if (d.type === 'FS' || d.type === 'SS') {
        if (toX >= fromX + 8) path = `M${fromX},${ay} H${toX - 6} V${by} H${toX - 1}`;
        // La sucesora comienza antes (adelanto): rodear por abajo.
        else path = `M${fromX},${ay} H${fromX + 6} V${ay + half} H${toX - 8} V${by} H${toX - 1}`;
      } else {
        // FF / CF: la flecha llega al fin de la sucesora por la derecha.
        path = `M${fromX},${ay} H${Math.max(fromX, toX) + 8} V${by} H${toX + 1}`;
        left = false;
      }
      const title = `${a.row} → ${b.row} (${nameOf(a.id)} → ${nameOf(b.id)}). Doble clic para quitar el vínculo.`;
      return { key: d.id, id: d.id, path, headX: toX, headY: by, left, critical: a.isCritical && b.isCritical, title, rows: `${a.row} → ${b.row}` };
    })
    .filter(Boolean) as {
    key: string;
    id: string;
    path: string;
    headX: number;
    headY: number;
    left: boolean;
    critical: boolean;
    title: string;
    rows: string;
  }[];

  const dragging = drag && drag.kind !== 'link' ? byId.get(drag.id) : undefined;
  const ghost = dragging && drag && drag.kind !== 'link' ? preview(dragging, drag) : null;

  return (
    <svg
      ref={svgRef}
      className={`gantt ${drag ? `dragging-${drag.kind}` : ''}`}
      width={width}
      height={height}
      style={{ display: 'block' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {/* Fondo de filas */}
      {result.order.map((t, i) => (
        <rect
          key={t.id}
          x={0}
          y={rowY(t.row)}
          width={width}
          height={ROW_HEIGHT}
          className={`gantt-row ${i % 2 ? 'odd' : ''} ${t.id === selectedId ? 'selected' : ''} ${
            drag?.kind === 'link' && drag.overId === t.id ? 'link-target' : ''
          }`}
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
        <g
          key={a.key}
          className={`gantt-arrow ${a.critical ? 'critical' : ''}`}
          onDoubleClick={() => {
            if (window.confirm(`¿Quitar el vínculo ${a.rows}?`)) removeDependency(a.id);
          }}
        >
          <title>{a.title}</title>
          <path d={a.path} className="hit" />
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
        const label = nameOf(t.id);
        const cy = y + ROW_HEIGHT / 2;
        const tip = `${t.row} · ${label}\n${t.isMilestone ? `Hito: ${fmt(t.start)}` : `${fmt(t.start)} → ${fmt(t.finish)} · ${t.durationDays} d`}${
          t.isSummary ? '' : `\nHolgura: ${t.slackDays} d${t.isCritical ? ' · ruta crítica' : ''}`
        }`;
        const handles = !t.isSummary && (
          <>
            <circle cx={x0 - 5} cy={cy} r={4} className="handle" onPointerDown={(e) => startLink(e, t.id, x0 - 5, cy)} />
            <circle cx={x1 + 5} cy={cy} r={4} className="handle" onPointerDown={(e) => startLink(e, t.id, x1 + 5, cy)} />
          </>
        );
        if (t.isMilestone) {
          const cx = x0 + pxPerDay / 2;
          const r = 7;
          return (
            <g key={t.id} className="gantt-milestone-g" onPointerDown={(e) => startDrag(e, t.id, 'move')}>
              <title>{tip}</title>
              <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} className="gantt-milestone" />
              <text x={cx + r + 4} y={cy + 4} className="gantt-label">
                {label} ({fmtShort(t.start)})
              </text>
              {handles}
            </g>
          );
        }
        if (t.isSummary) {
          const h = 6;
          const top = y + 7;
          return (
            <g key={t.id} onClick={() => select(t.id)} className="gantt-summary">
              <title>{tip}</title>
              <rect x={x0} y={top} width={w} height={h} />
              <polygon points={`${x0},${top + h} ${x0 + 6},${top + h} ${x0},${top + h + 6}`} />
              <polygon points={`${x1},${top + h} ${x1 - 6},${top + h} ${x1},${top + h + 6}`} />
              <text x={x1 + 6} y={cy + 4} className="gantt-label">
                {label}
              </text>
            </g>
          );
        }
        const top = y + (ROW_HEIGHT - BAR_H) / 2;
        return (
          <g key={t.id} className={`gantt-bar ${t.isCritical ? 'critical' : ''}`}>
            <title>{tip}</title>
            <rect x={x0} y={top} width={w} height={BAR_H} rx={2} className="bar" onPointerDown={(e) => startDrag(e, t.id, 'move')} />
            {t.percentComplete > 0 && <rect x={x0} y={top + 4} width={(w * t.percentComplete) / 100} height={BAR_H - 8} className="progress" />}
            <rect x={x1 - 5} y={top} width={6} height={BAR_H} className="resize" onPointerDown={(e) => startDrag(e, t.id, 'resize')} />
            <text x={x1 + 6} y={cy + 4} className="gantt-label">
              {label}
              {resourcesOf(t.id) && <tspan className="gantt-res"> · {resourcesOf(t.id)}</tspan>}
            </text>
            {handles}
          </g>
        );
      })}

      {/* Vista previa del arrastre */}
      {dragging && ghost && (
        <g className="gantt-ghost" pointerEvents="none">
          <rect
            x={x(ghost.start)}
            y={rowY(dragging.row) + (ROW_HEIGHT - BAR_H) / 2}
            width={Math.max(xEnd(ghost.finish) - x(ghost.start), 2)}
            height={BAR_H}
            rx={2}
          />
          <text x={x(ghost.start)} y={rowY(dragging.row) - 2}>
            {drag!.kind === 'move' ? `${fmt(ghost.start)} → ${fmt(ghost.finish)}` : `${ghost.durationDays} d · fin ${fmt(ghost.finish)}`}
          </text>
        </g>
      )}
      {drag?.kind === 'link' && (
        <g className="gantt-linking" pointerEvents="none">
          <line x1={drag.fromX} y1={drag.fromY} x2={drag.px} y2={drag.py} />
          <text x={drag.px + 8} y={drag.py - 6}>
            {drag.overId ? `Vincular con ${byId.get(drag.overId)?.row}` : 'Suelta sobre otra tarea'}
          </text>
        </g>
      )}

      {/* Línea de hoy */}
      {todayIso >= rangeStart && todayIso <= rangeEnd && (
        <g className="gantt-today" pointerEvents="none">
          <line x1={x(todayIso) + pxPerDay / 2} y1={HEADER_HEIGHT} x2={x(todayIso) + pxPerDay / 2} y2={height} />
          <text x={x(todayIso) + pxPerDay / 2 + 3} y={HEADER_HEIGHT + 12}>
            hoy
          </text>
        </g>
      )}
    </svg>
  );
}
