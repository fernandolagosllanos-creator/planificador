import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { computeWbs, useProject, visibleTaskIds, type ScheduleResult } from '@planificador/core';
import type { JiraIssue } from './client';
import { indexIssues, linkOf, summaryStatus, taskStatus, usedKeys, type TaskJiraStatus } from './links';
import { useJira } from './store';

function fmt(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

const DRAG_TYPE = 'application/x-planificador-issue';

/** Vista "Alinear": tabla de tareas con su estado en Jira y panel para vincular la seleccionada. */
export function AlignView({ result }: { result: ScheduleResult }) {
  const j = useJira();
  const project = useProject((s) => s.project);
  const selectedId = useProject((s) => s.selectedId);
  const select = useProject((s) => s.select);
  const link = project.jira ?? null;
  const issues = useMemo(() => indexIssues(j.issues), [j.issues]);
  const used = useMemo(() => usedKeys(link), [link]);
  const visible = useMemo(() => visibleTaskIds(project.tasks), [project.tasks]);
  const wbs = useMemo(() => computeWbs(project.tasks), [project.tasks]);

  useEffect(() => {
    if (link && j.status === 'connected' && j.issues.length === 0 && !j.loadingIssues) void j.refreshIssues();
    // Solo al entrar a la vista o al cambiar de proyecto/conexión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.projectKey, j.status]);

  if (j.status !== 'connected' || !link) {
    return (
      <div className="jira-view empty">
        <h2>{j.status !== 'connected' ? 'Sin conexión con Jira' : 'Proyecto sin vincular'}</h2>
        <p className="muted">Para alinear tareas con incidencias, conecta tu cuenta y vincula este proyecto con un proyecto de Jira.</p>
        <button className="primary" onClick={() => j.setShowConnect(true)}>
          {j.status !== 'connected' ? 'Conectar con Jira…' : 'Vincular con un proyecto de Jira…'}
        </button>
      </div>
    );
  }

  const suggest = () => {
    const list = j.suggestions();
    if (!list.length) {
      useProject.getState().setError('No se encontraron incidencias con nombre parecido a las tareas sin vincular.');
      return;
    }
    const rows = new Map(project.tasks.map((t, i) => [t.id, i + 1]));
    const names = new Map(project.tasks.map((t) => [t.id, t.name]));
    const preview = list
      .slice(0, 12)
      .map((s) => `  ${rows.get(s.taskId)} · ${names.get(s.taskId)}  →  ${s.key} ${issues.get(s.key)?.summary ?? ''}`)
      .join('\n');
    const more = list.length > 12 ? `\n  … y ${list.length - 12} más` : '';
    if (window.confirm(`Se vincularán ${list.length} tareas con la incidencia de nombre más parecido como base:\n\n${preview}${more}\n\n¿Aplicar? (se puede deshacer)`))
      j.applySuggestions(list);
  };

  const selected = project.tasks.find((t) => t.id === selectedId) ?? null;
  const linkedCount = link.links.length;

  return (
    <div className="align-view">
      <div className="align-table">
        <table>
          <thead>
            <tr>
              <th className="num">Id</th>
              <th>Nombre</th>
              <th className="num">Dur.</th>
              <th>Comienzo</th>
              <th>Fin</th>
              <th>Jira</th>
            </tr>
          </thead>
          <tbody>
            {project.tasks.map((t, i) => {
              if (!visible.has(t.id)) return null;
              const s = result.tasks.get(t.id)!;
              const st = s.isSummary ? null : taskStatus(link, t.id, issues);
              const sum = s.isSummary ? summaryStatus(project.tasks, i, link, issues) : null;
              return (
                <tr
                  key={t.id}
                  className={`${s.isSummary ? 'summary' : ''} ${t.id === selectedId ? 'selected' : ''}`}
                  onClick={() => select(t.id)}
                  onDragOver={(e) => !s.isSummary && allowDrop(e)}
                  onDrop={(e) => {
                    if (s.isSummary) return;
                    const key = dropKey(e);
                    if (key) {
                      select(t.id);
                      if (linkOf(link, t.id)?.base) j.addDependent(t.id, key);
                      else j.setBase(t.id, key);
                    }
                  }}
                >
                  <td className="num muted">{s.row}</td>
                  <td style={{ paddingLeft: 8 + t.level * 16 }}>
                    <span className="muted small">{wbs.get(t.id)} </span>
                    {t.name}
                  </td>
                  <td className="num muted">{s.isMilestone ? 'hito' : `${s.durationDays} d`}</td>
                  <td className="muted">{fmt(s.start)}</td>
                  <td className="muted">{fmt(s.finish)}</td>
                  <td>
                    {sum && sum.total > 0 && (
                      <span className={`chip ${sum.done === sum.total ? 'status-done' : sum.done ? 'status-indeterminate' : 'status-new'}`}>
                        {sum.done} / {sum.total}
                      </span>
                    )}
                    {st && <StatusCell st={st} />}
                    {!sum && !st && <span className="muted small">Sin vincular</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="align-panel">
        <div className="align-panel-head">
          <div>
            <strong>{link.projectName}</strong> <span className="muted">({link.projectKey})</span>
            <span className="muted small"> · {linkedCount} tareas vinculadas</span>
          </div>
          <div className="actions">
            <button onClick={() => j.refreshIssues()} disabled={j.loadingIssues} title="Volver a leer las incidencias de Jira">
              {j.loadingIssues ? 'Cargando…' : 'Actualizar'}
            </button>
            <button onClick={suggest} title="Propone como base la incidencia de nombre más parecido para cada tarea sin vincular">
              Sugerir vínculos
            </button>
          </div>
        </div>
        {selected ? <TaskPanel task={selected} status={taskStatus(link, selected.id, issues)} isSummary={!!result.tasks.get(selected.id)?.isSummary} /> : (
          <p className="muted">Selecciona una tarea en la tabla para vincularla.</p>
        )}
        <IssuePicker issues={j.issues} used={used} taskId={selected?.id ?? null} />
      </div>
    </div>
  );
}

function StatusCell({ st }: { st: TaskJiraStatus }) {
  if (st.missingBase && !st.base)
    return (
      <>
        <span className="issue-key">{st.missingBase}</span> <span className="chip warn">No está en Jira</span>
      </>
    );
  return (
    <>
      {st.base && (
        <>
          <span className="issue-key">{st.base.key}</span> <span className={`chip status-${st.base.statusCategory}`}>{st.base.status}</span>
        </>
      )}
      {st.dependents.length > 0 && (
        <span className="muted small" title={`${st.doneDependents} de ${st.dependents.length} dependientes hechas`}>
          {' '}
          +{st.dependents.length}
        </span>
      )}
    </>
  );
}

function TaskPanel({ task, status, isSummary }: { task: { id: string; name: string; percentComplete: number }; status: TaskJiraStatus | null; isSummary: boolean }) {
  const j = useJira();
  const setPercentComplete = useProject((s) => s.setPercentComplete);
  const row = useProject((s) => s.project.tasks.findIndex((t) => t.id === task.id) + 1);
  if (isSummary)
    return (
      <div className="align-task">
        <h3>
          {row} · {task.name}
        </h3>
        <p className="muted small">Las tareas resumen no se vinculan: muestran cuántas incidencias de sus subtareas están hechas.</p>
      </div>
    );
  const onDropBase = (e: DragEvent) => {
    const key = dropKey(e);
    if (key) j.setBase(task.id, key);
  };
  const onDropDep = (e: DragEvent) => {
    const key = dropKey(e);
    if (key) j.addDependent(task.id, key);
  };
  return (
    <div className="align-task">
      <h3>
        {row} · {task.name}
      </h3>
      <p className="muted small">Incidencia base (manda el estado y el responsable)</p>
      <div className="drop-zone" onDragOver={allowDrop} onDrop={onDropBase}>
        {status?.base ? (
          <IssueCard issue={status.base} base onRemove={() => j.removeIssue(status.base!.key)} />
        ) : status?.missingBase ? (
          <div className="issue-card missing">
            <span className="issue-key">{status.missingBase}</span> ya no está en el proyecto de Jira.
            <button className="link" onClick={() => j.removeIssue(status.missingBase!)}>
              Quitar
            </button>
          </div>
        ) : (
          <span className="muted small">Arrastra aquí una incidencia de la lista, o usa su botón "Base".</span>
        )}
      </div>
      <p className="muted small">
        Incidencias dependientes ({status?.dependents.length ?? 0})
        {status && status.dependents.length > 0 ? ` · ${status.doneDependents} de ${status.dependents.length} hechas` : ''}
      </p>
      <div className="drop-zone dependents" onDragOver={allowDrop} onDrop={onDropDep}>
        {status?.dependents.map((i) => (
          <IssueCard key={i.key} issue={i} onRemove={() => j.removeIssue(i.key)} />
        ))}
        {status?.missingDependents.map((k) => (
          <div key={k} className="issue-card missing">
            <span className="issue-key">{k}</span> ya no está en Jira.
            <button className="link" onClick={() => j.removeIssue(k)}>
              Quitar
            </button>
          </div>
        ))}
        <span className="muted small">Arrastra aquí una incidencia para agregarla como dependiente, o usa su botón "+ Dep.".</span>
      </div>
      {status && (
        <div className="actions">
          <button
            disabled={status.progress === null || status.progress === task.percentComplete}
            onClick={() => status.progress !== null && setPercentComplete(task.id, status.progress)}
            title="Fija el % completado de la tarea según Jira: 100 % si la base está hecha; si no, la proporción de dependientes hechas"
          >
            Tomar avance de Jira{status.progress !== null ? ` (${status.progress} %)` : ''}
          </button>
          <button onClick={() => j.unlinkTask(task.id)}>Quitar vínculo</button>
        </div>
      )}
    </div>
  );
}

function IssueCard({ issue, base, onRemove }: { issue: JiraIssue; base?: boolean; onRemove: () => void }) {
  const site = useProject((s) => s.project.jira?.siteUrl ?? '');
  return (
    <div className={`issue-card${base ? ' base' : ''}`}>
      <div className="issue-line">
        <a className="issue-key" href={`${site}/browse/${issue.key}`} target="_blank" rel="noreferrer">
          {issue.key}
        </a>
        <span className="issue-summary">{issue.summary}</span>
        <span className={`chip status-${issue.statusCategory}`}>{issue.status}</span>
        <button className="link" onClick={onRemove} title="Quitar de esta tarea">
          Quitar
        </button>
      </div>
      <div className="muted small">
        {issue.assignee ?? 'Sin asignar'} · {issue.type}
        {issue.dueDate ? ` · vence ${fmt(issue.dueDate)}` : ''}
      </div>
    </div>
  );
}

function IssuePicker({ issues, used, taskId }: { issues: JiraIssue[]; used: Map<string, string>; taskId: string | null }) {
  const j = useJira();
  const [filter, setFilter] = useState('');
  const [onlyFree, setOnlyFree] = useState(true);
  const rows = useProject((s) => s.project.tasks);
  const rowOf = useMemo(() => new Map(rows.map((t, i) => [t.id, i + 1])), [rows]);
  const f = filter.trim().toLowerCase();
  const list = issues.filter((i) => (!onlyFree || !used.has(i.key)) && (!f || i.key.toLowerCase().includes(f) || i.summary.toLowerCase().includes(f)));
  return (
    <div className="issue-picker">
      <div className="issue-picker-head">
        <input placeholder="Buscar por clave o texto" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="small">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> solo sin vincular
        </label>
        <span className="muted small">{list.length}</span>
      </div>
      <div className="issue-list">
        {list.map((i) => (
          <div
            key={i.key}
            className="issue-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, i.key);
              e.dataTransfer.effectAllowed = 'link';
            }}
            title="Arrastra sobre una tarea de la tabla o sobre el panel de la tarea seleccionada"
          >
            <span className="issue-key">{i.key}</span>
            <span className="issue-summary">{i.summary}</span>
            <span className={`chip status-${i.statusCategory}`}>{i.status}</span>
            {used.has(i.key) ? (
              <span className="muted small">#{rowOf.get(used.get(i.key)!)}</span>
            ) : (
              <span className="issue-actions">
                <button className="small-btn" disabled={!taskId} onClick={() => taskId && j.setBase(taskId, i.key)} title="Usar como incidencia base de la tarea seleccionada">
                  Base
                </button>
                <button className="small-btn" disabled={!taskId} onClick={() => taskId && j.addDependent(taskId, i.key)} title="Agregar como dependiente de la tarea seleccionada">
                  + Dep.
                </button>
              </span>
            )}
          </div>
        ))}
        {!list.length && <p className="muted small">{issues.length ? 'Ninguna incidencia coincide.' : 'Aún no se han cargado incidencias.'}</p>}
      </div>
    </div>
  );
}

function allowDrop(e: DragEvent) {
  if (e.dataTransfer.types.includes(DRAG_TYPE)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
  }
}

function dropKey(e: DragEvent): string | null {
  const key = e.dataTransfer.getData(DRAG_TYPE);
  if (!key) return null;
  e.preventDefault();
  e.stopPropagation();
  return key;
}
