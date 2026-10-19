import { useEffect } from 'react';
import { useProject } from '@planificador/core';
import { usedKeys } from './links';
import { useJira } from './store';

function fmt(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** Vista "Jira": estado de la conexión y las incidencias del proyecto vinculado. */
export function JiraView() {
  const j = useJira();
  const link = useProject((s) => s.project.jira) ?? null;

  useEffect(() => {
    if (link && j.status === 'connected' && j.issues.length === 0 && !j.loadingIssues) void j.refreshIssues();
    // Solo al entrar a la vista o al cambiar de proyecto/conexión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.projectKey, j.status]);

  if (j.status !== 'connected') {
    return (
      <div className="jira-view empty">
        <h2>Sin conexión con Jira</h2>
        <p className="muted">
          {j.status === 'connecting'
            ? 'Comprobando la sesión guardada…'
            : j.error ?? 'Conecta tu cuenta de Jira Cloud para vincular este proyecto con un proyecto de Jira.'}
        </p>
        <button className="primary" onClick={() => j.setShowConnect(true)}>
          Conectar con Jira…
        </button>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="jira-view empty">
        <h2>Proyecto sin vincular</h2>
        <p className="muted">
          Conectado como {j.user?.displayName} en {j.account?.site}. Este proyecto todavía no está vinculado con un proyecto de Jira.
        </p>
        <button className="primary" onClick={() => j.setShowConnect(true)}>
          Vincular con un proyecto de Jira…
        </button>
      </div>
    );
  }

  const used = usedKeys(link);
  const rowOf = new Map(useProject.getState().project.tasks.map((t, i) => [t.id, i + 1]));

  return (
    <div className="jira-view">
      <div className="jira-head">
        <div>
          <h2>
            {link.projectName} <span className="muted">({link.projectKey})</span>
          </h2>
          <p className="muted small">
            {link.siteUrl} · {j.user?.displayName} · {link.boardId ? `tablero ${link.boardId}` : 'sin tablero'} · fin en {link.dueDateField}
            {link.startDateField ? `, inicio en ${link.startDateField}` : ', sin fecha de inicio'} · {link.links.length} tareas vinculadas
          </p>
        </div>
        <div className="actions">
          <button onClick={() => j.refreshIssues()} disabled={j.loadingIssues}>
            {j.loadingIssues ? 'Cargando…' : 'Actualizar'}
          </button>
          <button onClick={() => j.setShowConnect(true)}>Cambiar proyecto…</button>
        </div>
      </div>
      <div className="jira-issues">
        <table>
          <thead>
            <tr>
              <th>Clave</th>
              <th>Tipo</th>
              <th>Resumen</th>
              <th>Estado</th>
              <th>Responsable</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Tarea</th>
            </tr>
          </thead>
          <tbody>
            {j.issues.map((i) => (
              <tr key={i.key}>
                <td>
                  <a href={`${link.siteUrl}/browse/${i.key}`} target="_blank" rel="noreferrer">
                    {i.key}
                  </a>
                </td>
                <td>{i.type}</td>
                <td>{i.summary}</td>
                <td>
                  <span className={`chip status-${i.statusCategory}`}>{i.status}</span>
                </td>
                <td>{i.assignee ?? <span className="muted">Sin asignar</span>}</td>
                <td>{fmt(i.startDate)}</td>
                <td>{fmt(i.dueDate)}</td>
                <td>{used.has(i.key) ? `#${rowOf.get(used.get(i.key)!) ?? '?'}` : ''}</td>
              </tr>
            ))}
            {!j.loadingIssues && j.issues.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No hay incidencias en el proyecto (o aún no se han cargado).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small jira-foot">
        En la vista "Alinear" se vincula cada tarea con su incidencia base y sus dependientes. El tablero simplificado y la escritura de estados,
        comentarios y fechas llegan en las etapas siguientes.
      </p>
    </div>
  );
}
