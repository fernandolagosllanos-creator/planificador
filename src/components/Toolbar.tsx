import { useState } from 'react';
import { useProject, type Zoom } from '../store/project';
import { CalendarDialog } from './CalendarDialog';
import { today } from '../engine/calendar';
import { openProjectFile, saveProjectFile } from '../file/planif';

export function Toolbar() {
  const s = useProject();
  const sel = s.selectedId;
  const [showCalendar, setShowCalendar] = useState(false);

  const doOpen = async () => {
    try {
      const r = await openProjectFile();
      if (r) s.loadProject(r.project, r.path);
    } catch (e) {
      s.setError(`No se pudo abrir el archivo: ${(e as Error).message}`);
    }
  };

  const doSave = async (forceDialog = false) => {
    try {
      const path = await saveProjectFile(s.project, s.filePath, forceDialog);
      if (path) s.markSaved(path);
    } catch (e) {
      s.setError(`No se pudo guardar: ${(e as Error).message}`);
    }
  };

  const doNew = () => {
    if (s.dirty && !window.confirm('Hay cambios sin guardar. ¿Crear un proyecto nuevo de todas formas?')) return;
    s.newProject();
  };

  return (
    <div className="toolbar">
      <div className="group">
        <button onClick={doNew} title="Nuevo proyecto (Ctrl+N)">
          Nuevo
        </button>
        <button onClick={doOpen} title="Abrir archivo .planif (Ctrl+O)">
          Abrir…
        </button>
        <button onClick={() => doSave(false)} title="Guardar (Ctrl+S)">
          Guardar
        </button>
        <button onClick={() => doSave(true)} title="Guardar como…">
          Guardar como…
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <button onClick={s.undo} disabled={!s.past.length} title="Deshacer (Ctrl+Z)">
          ↶ Deshacer
        </button>
        <button onClick={s.redo} disabled={!s.future.length} title="Rehacer (Ctrl+Y)">
          ↷ Rehacer
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <button onClick={() => s.addTaskAfter(sel)} title="Insertar tarea debajo de la seleccionada (Insert)">
          + Tarea
        </button>
        <button onClick={() => sel && s.deleteTask(sel)} disabled={!sel} title="Eliminar tarea (Supr)">
          Eliminar
        </button>
        <button onClick={() => sel && s.indent(sel)} disabled={!sel} title="Aplicar sangría (Alt+Shift+→)">
          → Sangría
        </button>
        <button onClick={() => sel && s.outdent(sel)} disabled={!sel} title="Anular sangría (Alt+Shift+←)">
          ← Anular
        </button>
        <button onClick={() => sel && s.moveTask(sel, -1)} disabled={!sel} title="Subir">
          ↑
        </button>
        <button onClick={() => sel && s.moveTask(sel, 1)} disabled={!sel} title="Bajar">
          ↓
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <button onClick={() => setShowCalendar(true)} title="Días laborables y feriados del proyecto">
          Calendario…
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <label>
          Zoom
          <select value={s.zoom} onChange={(e) => s.setZoom(e.target.value as Zoom)}>
            <option value="day">Días</option>
            <option value="week">Semanas</option>
            <option value="month">Meses</option>
          </select>
        </label>
        <button onClick={() => s.goToDate(today())} title="Desplazar la Gantt hasta la fecha de hoy">
          Hoy
        </button>
        <button onClick={() => s.goToDate(s.project.start)} title="Desplazar la Gantt hasta el inicio del proyecto">
          Inicio
        </button>
      </div>
      <div className="spacer" />
      <div className="group project-meta">
        <label>
          Proyecto
          <input value={s.project.name} onChange={(e) => s.setProjectName(e.target.value)} style={{ width: 220 }} />
        </label>
        <label>
          Inicio
          <input type="date" value={s.project.start} onChange={(e) => e.target.value && s.setProjectStart(e.target.value)} />
        </label>
      </div>
      {showCalendar && <CalendarDialog onClose={() => setShowCalendar(false)} />}
    </div>
  );
}
