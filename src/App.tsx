import { useEffect, useMemo, useRef } from 'react';
import { Gantt } from './components/Gantt';
import { TaskDetail } from './components/TaskDetail';
import { TaskTable } from './components/TaskTable';
import { Toolbar } from './components/Toolbar';
import { schedule } from './engine/schedule';
import { autosave, isTauri, loadAutosave, saveProjectFile } from './file/planif';
import { useProject } from './store/project';

export default function App() {
  const s = useProject();
  const result = useMemo(() => schedule(s.project), [s.project]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

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
    document.title = `${title} - Planificador`;
  }, [title]);

  return (
    <div className="app">
      <Toolbar />
      {s.error && (
        <div className="error-bar" onClick={() => s.setError(null)}>
          ⚠ {s.error} <span className="dismiss">(clic para cerrar)</span>
        </div>
      )}
      {result.cycle.length > 0 && (
        <div className="error-bar">⚠ Hay un ciclo de dependencias en las filas {result.cycle.map((id) => result.tasks.get(id)!.row).join(', ')}.</div>
      )}
      <div className="split">
        <div className="pane left" ref={leftRef} onScroll={() => sync(leftRef.current, rightRef.current)}>
          <TaskTable result={result} />
        </div>
        <div className="pane right" ref={rightRef} onScroll={() => sync(rightRef.current, leftRef.current)}>
          <Gantt result={result} />
        </div>
      </div>
      <TaskDetail result={result} />
      <div className="statusbar">
        <span>{s.project.tasks.length} tareas</span>
        <span>Inicio: {fmt(result.projectStart)}</span>
        <span>Fin: {fmt(result.projectFinish)}</span>
        <span>{s.filePath ? s.filePath : 'Sin guardar en archivo'}</span>
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
