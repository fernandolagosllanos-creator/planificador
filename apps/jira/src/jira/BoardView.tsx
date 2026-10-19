import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useProject } from '@planificador/core';
import type { JiraIssue, JiraStatus } from './client';
import { buildColumns, filterIssues, type BoardFilter } from './board';
import { linkOf, usedKeys } from './links';
import { useJira } from './store';

const DRAG_TYPE = 'application/x-planificador-issue';

function fmt(iso: string | null): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}-${m}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Tablero simplificado: columnas por estado de Jira; arrastrar una tarjeta cambia su estado en Jira. */
export function BoardView() {
  const j = useJira();
  const project = useProject((s) => s.project);
  const link = project.jira ?? null;
  const [filter, setFilter] = useState<BoardFilter>({ task: '', assignee: '', text: '' });
  const [over, setOver] = useState<string | null>(null);

  const taskOf = useMemo(() => usedKeys(link), [link]);
  const taskRow = useMemo(() => new Map(project.tasks.map((t, i) => [t.id, { row: i + 1, name: t.name }])), [project.tasks]);
  const assignees = useMemo(() => [...new Set(j.issues.map((i) => i.assignee).filter((a): a is string => !!a))].sort(), [j.issues]);
  const visible = useMemo(() => filterIssues(j.issues, filter, taskOf), [j.issues, filter, taskOf]);
  const columns = useMemo(() => buildColumns(j.statuses, visible), [j.statuses, visible]);
  const linkedTasks = useMemo(() => (link?.links ?? []).map((l) => l.taskId).filter((id) => taskRow.has(id)).sort((a, b) => taskRow.get(a)!.row - taskRow.get(b)!.row), [link, taskRow]);

  useEffect(() => {
    if (link && j.status === 'connected' && j.issues.length === 0 && !j.loadingIssues) void j.refreshIssues();
    // Solo al entrar a la vista o al cambiar de proyecto/conexión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.projectKey, j.status]);

  if (j.status !== 'connected' || !link) {
    return (
      <div className="jira-view empty">
        <h2>{j.status !== 'connected' ? 'Sin conexión con Jira' : 'Proyecto sin vincular'}</h2>
        <p className="muted">El tablero muestra las incidencias del proyecto de Jira vinculado, por estado.</p>
        <button className="primary" onClick={() => j.setShowConnect(true)}>
          {j.status !== 'connected' ? 'Conectar con Jira…' : 'Vincular con un proyecto de Jira…'}
        </button>
      </div>
    );
  }

  const onDrop = (e: DragEvent, target: JiraStatus) => {
    const key = e.dataTransfer.getData(DRAG_TYPE);
    setOver(null);
    if (!key) return;
    e.preventDefault();
    void j.moveIssue(key, target);
  };

  return (
    <div className="board-view">
      <div className="board-head">
        <div className="board-filters">
          <input placeholder="Buscar por clave o texto" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
          <select value={filter.task} onChange={(e) => setFilter({ ...filter, task: e.target.value })} title="Filtrar por tarea del planificador">
            <option value="">Todas las incidencias</option>
            <option value="linked">Solo vinculadas a tareas</option>
            <option value="unlinked">Solo sin vincular</option>
            {linkedTasks.map((id) => (
              <option key={id} value={id}>
                {taskRow.get(id)!.row} · {taskRow.get(id)!.name}
              </option>
            ))}
          </select>
          <select value={filter.assignee} onChange={(e) => setFilter({ ...filter, assignee: e.target.value })} title="Filtrar por responsable">
            <option value="">Cualquier responsable</option>
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="muted small">
            {visible.length} de {j.issues.length}
          </span>
        </div>
        <div className="actions">
          <button onClick={() => j.refreshIssues()} disabled={j.loadingIssues} title="Volver a leer las incidencias y estados de Jira">
            {j.loadingIssues ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>
      </div>
      <div className="board">
        {columns.map((c) => (
          <div
            key={c.status.name}
            className={`board-column cat-${c.status.category}${over === c.status.name ? ' over' : ''}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== c.status.name) setOver(c.status.name);
              }
            }}
            onDragLeave={() => over === c.status.name && setOver(null)}
            onDrop={(e) => onDrop(e, c.status)}
          >
            <div className="board-column-head">
              <h3>{c.status.name}</h3>
              <span className="muted small">{c.issues.length}</span>
            </div>
            <div className="board-cards">
              {c.issues.map((i) => (
                <IssueCard key={i.key} issue={i} site={link.siteUrl} task={taskOf.get(i.key) ? taskRow.get(taskOf.get(i.key)!) : undefined} isBase={!!taskOf.get(i.key) && linkOf(link, taskOf.get(i.key)!)?.base === i.key} moving={j.moving.has(i.key)} columns={columns.map((x) => x.status)} />
              ))}
              {over === c.status.name && <div className="board-drop muted small">Soltar aquí para pasar a "{c.status.name}"</div>}
            </div>
          </div>
        ))}
        {columns.length === 0 && <p className="muted">{j.loadingIssues ? 'Cargando incidencias…' : 'No hay incidencias que mostrar.'}</p>}
      </div>
      <p className="muted small board-foot">
        Arrastra una tarjeta a otra columna para cambiar su estado en Jira (usa las transiciones que Jira permite; si una pide datos, se abre la incidencia
        en el navegador). Comentarios y fechas planificadas llegan en la etapa 5.
      </p>
    </div>
  );
}

function IssueCard({ issue, site, task, isBase, moving, columns }: { issue: JiraIssue; site: string; task?: { row: number; name: string }; isBase: boolean; moving: boolean; columns: JiraStatus[] }) {
  const j = useJira();
  const [menu, setMenu] = useState(false);
  return (
    <div
      className={`board-card${isBase ? ' base' : ''}${moving ? ' moving' : ''}`}
      draggable={!moving}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, issue.key);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      {task && (
        <div className="board-card-task muted small" title="Tarea del planificador vinculada">
          {task.row} · {task.name}
          {isBase ? ' · base' : ''}
        </div>
      )}
      <div className="board-card-line">
        <a className="issue-key" href={`${site}/browse/${issue.key}`} target="_blank" rel="noreferrer" title="Abrir en Jira">
          {issue.key}
        </a>
        <span className="board-card-summary">{issue.summary}</span>
      </div>
      <div className="board-card-meta">
        <span className="muted small">
          {issue.type}
          {issue.dueDate ? ` · vence ${fmt(issue.dueDate)}` : ''}
        </span>
        <span className="board-card-right">
          {moving ? (
            <span className="muted small">cambiando…</span>
          ) : (
            <span className="menu" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setMenu(false)}>
              <button className="link small" onClick={() => setMenu((m) => !m)} title="Mover a otro estado" aria-haspopup="menu" aria-expanded={menu}>
                Mover ▾
              </button>
              {menu && (
                <div className="menu-list" role="menu" onClick={() => setMenu(false)}>
                  {columns
                    .filter((s) => s.name !== issue.status)
                    .map((s) => (
                      <button key={s.name} onClick={() => j.moveIssue(issue.key, s)}>
                        {s.name}
                      </button>
                    ))}
                </div>
              )}
            </span>
          )}
          {issue.assignee ? (
            <span className="avatar" title={issue.assignee}>
              {initials(issue.assignee)}
            </span>
          ) : (
            <span className="avatar empty" title="Sin asignar">
              –
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
