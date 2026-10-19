import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Gantt } from './Gantt';
import { ResourceLoad } from './ResourceLoad';
import { ResourceSheet } from './ResourceSheet';
import { TaskDetail } from './TaskDetail';
import { TaskTable } from './TaskTable';
import { Toolbar } from './Toolbar';
import { schedule, type ScheduleResult } from '../engine/schedule';
import { autosave, isTauri, loadAutosave, saveProjectFile } from '../file/planif';
import { useProject } from '../store/project';
import { promptForUpdate } from '../updater';
import { appName, appVersion } from '../appInfo';
import { WorkCalendar } from '../engine/calendar';
import { projectProgress } from '../engine/tracking';

export interface AppShellProps {
  /** Barra de herramientas; por defecto la del Planificador simple. */
  toolbar?: ReactNode;
  /** Vistas adicionales de la app, por id de vista; reciben el resultado de programación. */
  views?: Record<string, (result: ScheduleResult) => ReactNode>;
  /** Elementos extra en la barra de estado (por ejemplo el estado de la conexión con Jira). */
  status?: ReactNode;
}

/**
 * Pantalla principal común a las apps: barra, errores, vistas, panel de detalle y
 * barra de estado, con atajos de teclado, autoguardado y comprobación de actualizaciones.
 */
export function AppShell({ toolbar, views, status }: AppShellProps) {
  const s = useProject();
  const result = useMemo(() => schedule(s.project), [s.project]);
  const progress = useMemo(() => {
    const cal = new WorkCalendar(s.project.calendars.find((c) => c.id === s.project.calendarId) ?? s.project.calendars[0]);
    return projectProgress(result, s.project.statusDate, cal);
  }, [result, s.project.calendars, s.project.calendarId, s.project.statusDate]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // Buscar actualizaciones al iniciar (solo en la aplicación de escritorio, sin molestar si no hay).
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri()) void promptForUpdate(true, setUpdateMsg);
  }, []);

  // Restaurar el autoguardado del navegador la primera vez (modo desarrollo).
  useEffect(() => {
    if (isTauri()) return;
    const saved = loadAutosave();
    if (saved) useProject.getState().loadProject(saved, null);
  }, []);

  useEffect(() => {
    if (!isTauri()) autosave(s.project);
  }, [s.project]);

  // Atajos de teclado.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA';
      const mod = e.ctrlKey || e.metaKey;
      const st = useProject.getState();
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const path = await saveProjectFile(st.project, st.filePath, e.shiftKey);
        if (path) st.markSaved(path);
      } else if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        st.redo();
      } else if (!typing && st.selectedId) {
        const idx = st.project.tasks.findIndex((t) => t.id === st.selectedId);
        if (e.key === 'Insert') st.addTaskAfter(st.selectedId);
        else if (e.key === 'Delete') st.deleteTask(st.selectedId);
        else if (e.altKey && e.shiftKey && e.key === 'ArrowRight') st.indent(st.selectedId);
        else if (e.altKey && e.shiftKey && e.key === 'ArrowLeft') st.outdent(st.selectedId);
        else if (e.key === 'ArrowDown' && idx < st.project.tasks.length - 1) st.select(st.project.tasks[idx + 1].id);
        else if (e.key === 'ArrowUp' && idx > 0) st.select(st.project.tasks[idx - 1].id);
        else return;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sincronizar el scroll vertical de la tabla y la Gantt.
  const syncing = useRef(false);
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => (syncing.current = false));
  };

  const title = `${s.project.name}${s.dirty ? ' •' : ''}`;
  useEffect(() => {
    document.title = `${title} - ${appName()}`;
  }, [title]);

  return (
    <div className="app">
      {toolbar ?? <Toolbar />}
      {s.error && (
        <div className="error-bar" onClick={() => s.setError(null)}>
          ⚠ {s.error} <span className="dismiss">(clic para cerrar)</span>
        </div>
      )}
      {result.cycle.length > 0 && (
        <div className="error-bar">⚠ Hay un ciclo de dependencias en las filas {result.cycle.map((id) => result.tasks.get(id)!.row).join(', ')}.</div>
      )}
      {s.view === 'gantt' && (
        <>
          <div className="split">
            <div className="pane left" ref={leftRef} onScroll={() => sync(leftRef.current, rightRef.current)}>
              <TaskTable result={result} />
            </div>
            <div className="pane right" ref={rightRef} onScroll={() => sync(rightRef.current, leftRef.current)}>
              <Gantt result={result} />
            </div>
          </div>
          <TaskDetail result={result} />
        </>
      )}
      {s.view === 'resources' && <ResourceSheet result={result} />}
      {s.view === 'load' && <ResourceLoad result={result} />}
      {views?.[s.view]?.(result)}
      <div className="statusbar">
        <span>{s.project.tasks.length} tareas</span>
        <span>Inicio: {fmt(result.projectStart)}</span>
        <span>Fin: {fmt(result.projectFinish)}</span>
        <span>
          Avance: {progress.actual}%{s.project.statusDate ? ` (planificado ${progress.planned}% al ${fmt(s.project.statusDate)})` : ''}
        </span>
        <span>{s.project.baseline ? `Línea base: ${fmt(s.project.baseline.savedAt.slice(0, 10))}` : 'Sin línea base'}</span>
        <span>{s.filePath ? s.filePath : 'Sin guardar en archivo'}</span>
        {status}
        <span>
          v{appVersion()}
          {isTauri() && (
            <>
              {' · '}
              <button className="link" onClick={() => promptForUpdate(false, setUpdateMsg)} title="Comprobar si hay una versión nueva">
                buscar actualizaciones
              </button>
            </>
          )}
          {updateMsg && <> · {updateMsg}</>}
        </span>
        <span className="hint">
          Doble clic para editar · Arrastra una barra para moverla, su borde derecho para alargarla y el punto de un extremo hasta otra barra para
          vincular
        </span>
      </div>
    </div>
  );
}

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}
