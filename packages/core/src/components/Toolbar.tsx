import { useState, type ReactNode } from 'react';
import { strToU8 } from 'fflate';
import { BASE_VIEWS, useProject, type View, type Zoom } from '../store/project';
import { CalendarDialog } from './CalendarDialog';
import { today } from '../engine/calendar';
import { openBytes, openProjectFile, openWithSystem, safeFileName, saveBytes, saveProjectFile, isTauri } from '../file/planif';
import { exportMspdi, importMspdi } from '../file/mspdi';
import { taskRows, toCsv, toXlsx } from '../file/tabular';
import { buildPrintReport } from '../file/report';
import { schedule } from '../engine/schedule';
import { WorkCalendar } from '../engine/calendar';

export interface ToolbarProps {
  /** Botones de vista; por defecto Gantt, Recursos y Carga. */
  views?: [View, string][];
  /** Grupo adicional (por ejemplo el menú Jira), a la derecha del calendario. */
  extra?: ReactNode;
}

export function Toolbar({ views = BASE_VIEWS, extra }: ToolbarProps = {}) {
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

  const confirmDiscard = () => !s.dirty || window.confirm('Hay cambios sin guardar. ¿Continuar de todas formas?');

  const doImportXml = async () => {
    try {
      const r = await openBytes('XML de Microsoft Project', ['xml']);
      if (!r) return;
      const project = importMspdi(new TextDecoder().decode(r.bytes));
      if (!confirmDiscard()) return;
      s.loadProject(project, null);
    } catch (e) {
      s.setError(`No se pudo importar el XML: ${(e as Error).message}`);
    }
  };

  const base = () => safeFileName(s.project.name);
  const rows = () => {
    const cal = new WorkCalendar(s.project.calendars.find((c) => c.id === s.project.calendarId) ?? s.project.calendars[0]);
    return taskRows(s.project, schedule(s.project), cal);
  };
  const doExport = async (kind: 'xml' | 'xlsx' | 'csv' | 'report') => {
    try {
      if (kind === 'xml') await saveBytes(strToU8(exportMspdi(s.project)), `${base()}.xml`, 'XML de Microsoft Project', 'xml', 'application/xml');
      else if (kind === 'xlsx') await saveBytes(toXlsx(rows()), `${base()}.xlsx`, 'Libro de Excel', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      else if (kind === 'csv') await saveBytes(strToU8(toCsv(rows())), `${base()}.csv`, 'CSV (separado por punto y coma)', 'csv', 'text/csv');
      else {
        if (s.view !== 'gantt') {
          s.setError('Cambia a la vista Gantt para generar el informe');
          return;
        }
        const html = buildPrintReport(s.project, schedule(s.project));
        if (isTauri()) {
          const path = await saveBytes(strToU8(html), `${base()} - informe.html`, 'Informe (página web)', 'html', 'text/html');
          if (path) await openWithSystem(path);
        } else {
          const w = window.open('', '_blank');
          if (w) {
            w.document.write(html);
            w.document.close();
          }
        }
      }
    } catch (e) {
      s.setError(`No se pudo exportar: ${(e as Error).message}`);
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
        <Menu label="Importar">
          <button onClick={doImportXml}>XML de Microsoft Project…</button>
        </Menu>
        <Menu label="Exportar">
          <button onClick={() => doExport('xml')}>XML de Microsoft Project…</button>
          <button onClick={() => doExport('xlsx')}>Tabla de tareas a Excel (.xlsx)…</button>
          <button onClick={() => doExport('csv')}>Tabla de tareas a CSV…</button>
          <button onClick={() => doExport('report')}>Informe para imprimir o PDF…</button>
        </Menu>
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
        <button onClick={() => sel && s.groupLinked(sel)} disabled={!sel} title="Reúne la tarea seleccionada y las vinculadas a ella bajo una tarea resumen nueva">
          Agrupar vinculadas
        </button>
        <button onClick={() => sel && s.ungroup(sel)} disabled={!sel} title="Quita la tarea resumen seleccionada y sube sus subtareas un nivel">
          Desagrupar
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
        <button
          onClick={() => {
            if (!s.project.baseline || window.confirm('Ya hay una línea base guardada. ¿Reemplazarla con las fechas actuales?')) s.saveBaseline();
          }}
          title="Guarda las fechas actuales como línea base para medir desviaciones"
        >
          {s.project.baseline ? 'Línea base ✓' : 'Guardar línea base'}
        </button>
        <button onClick={s.clearBaseline} disabled={!s.project.baseline} title="Borrar la línea base guardada">
          Borrar LB
        </button>
        <label title="Fecha hasta la que está registrado el avance; dibuja la línea de progreso">
          Fecha de estado
          <input type="date" value={s.project.statusDate ?? ''} onChange={(e) => s.setStatusDate(e.target.value || null)} />
        </label>
      </div>
      <div className="sep" />
      <div className="group views">
        {views.map(([v, label]) => (
          <button key={v} className={s.view === v ? 'active' : ''} onClick={() => s.setView(v)}>
            {label}
          </button>
        ))}
      </div>
      <div className="sep" />
      <div className="group">
        <button onClick={() => setShowCalendar(true)} title="Días laborables y feriados del proyecto">
          Calendario…
        </button>
      </div>
      {extra && (
        <>
          <div className="sep" />
          <div className="group">{extra}</div>
        </>
      )}
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

/** Menú desplegable sencillo: un botón que muestra una lista de acciones. */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {label} ▾
      </button>
      {open && (
        <div className="menu-list" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
