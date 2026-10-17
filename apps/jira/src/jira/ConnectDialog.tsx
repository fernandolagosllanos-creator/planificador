import { useEffect, useState } from 'react';
import { useProject, type JiraLink } from '@planificador/core';
import * as jira from './client';
import { useJira } from './store';

type Step = 'credentials' | 'project' | 'fields';

/**
 * Asistente de conexión en tres pasos: credenciales → proyecto de Jira → campos de fecha.
 * Si ya hay sesión, parte en el paso del proyecto.
 */
export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const j = useJira();
  const project = useProject((s) => s.project);
  const current = project.jira ?? null;
  const [step, setStep] = useState<Step>(j.status === 'connected' ? 'project' : 'credentials');

  // Paso 1
  const [site, setSite] = useState(j.account?.site ?? current?.siteUrl ?? '');
  const [email, setEmail] = useState(j.account?.email ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Paso 2
  const [projects, setProjects] = useState<jira.JiraProject[] | null>(null);
  const [filter, setFilter] = useState('');
  const [projectKey, setProjectKey] = useState(current?.projectKey ?? '');
  const [boards, setBoards] = useState<jira.JiraBoard[]>([]);
  const [boardId, setBoardId] = useState<number | null>(current?.boardId ?? null);

  // Paso 3
  const [fields, setFields] = useState<jira.JiraField[] | null>(null);
  const [startField, setStartField] = useState<string | null>(current?.startDateField ?? null);
  const [dueField, setDueField] = useState(current?.dueDateField ?? 'duedate');

  const fail = (e: unknown) => setError((e as Error).message);

  useEffect(() => {
    if (step !== 'project' || projects) return;
    jira.listProjects().then(setProjects).catch(fail);
  }, [step, projects]);

  useEffect(() => {
    if (!projectKey || step !== 'project') return;
    let alive = true;
    jira.listBoards(projectKey).then((b) => {
      if (!alive) return;
      setBoards(b);
      setBoardId((id) => (id !== null && b.some((x) => x.id === id) ? id : (b[0]?.id ?? null)));
    });
    return () => void (alive = false);
  }, [projectKey, step]);

  useEffect(() => {
    if (step !== 'fields' || fields) return;
    jira
      .listDateFields()
      .then((f) => {
        setFields(f);
        setStartField((cur) => cur ?? jira.guessStartField(f));
      })
      .catch(fail);
  }, [step, fields]);

  const doConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await j.connect(site, email, token);
      setToken('');
      setStep('project');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    const p = projects?.find((x) => x.key === projectKey);
    if (!p || !j.account) return;
    const link: JiraLink = {
      siteUrl: j.account.site,
      projectKey: p.key,
      projectName: p.name,
      boardId,
      startDateField: startField,
      dueDateField: dueField || 'duedate',
      links: current && current.projectKey === p.key ? current.links : [],
      lastSync: current && current.projectKey === p.key ? current.lastSync : null,
    };
    j.linkProject(link);
    useProject.getState().setView('jira');
    void j.refreshIssues();
    onClose();
  };

  const visibleProjects = (projects ?? []).filter((p) => {
    const f = filter.trim().toLowerCase();
    return !f || p.key.toLowerCase().includes(f) || p.name.toLowerCase().includes(f);
  });

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal jira-connect" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Conectar con Jira">
        <div className="modal-head">
          <strong>Conectar con Jira Cloud</strong>
          <button onClick={onClose}>Cerrar</button>
        </div>
        <ol className="steps">
          <li className={step === 'credentials' ? 'active' : 'done'}>1. Cuenta</li>
          <li className={step === 'project' ? 'active' : step === 'fields' ? 'done' : ''}>2. Proyecto</li>
          <li className={step === 'fields' ? 'active' : ''}>3. Fechas</li>
        </ol>
        <div className="modal-body">
          {error && <div className="error-bar">⚠ {error}</div>}

          {step === 'credentials' && (
            <div className="form">
              <label>
                Sitio de Jira
                <input placeholder="https://miempresa.atlassian.net" value={site} onChange={(e) => setSite(e.target.value)} autoFocus />
              </label>
              <label>
                Correo de la cuenta de Atlassian
                <input type="email" placeholder="nombre@empresa.cl" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                Token de API
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doConnect()} />
              </label>
              <p className="muted small">
                El token se crea en{' '}
                <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
                  id.atlassian.com → Seguridad → Tokens de API
                </a>
                . Se guarda en el llavero de tu computador, nunca dentro del archivo del proyecto.
              </p>
              <div className="actions">
                <button className="primary" disabled={busy || !site || !email || !token} onClick={doConnect}>
                  {busy ? 'Conectando…' : 'Probar y conectar'}
                </button>
              </div>
            </div>
          )}

          {step === 'project' && (
            <div className="form">
              <p>
                Conectado como <strong>{j.user?.displayName ?? j.account?.email}</strong> en {j.account?.site}.{' '}
                <button className="link" onClick={() => setStep('credentials')}>
                  Cambiar cuenta
                </button>
              </p>
              <label>
                Buscar proyecto
                <input placeholder="Clave o nombre" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
              </label>
              <div className="project-list">
                {!projects && !error && <p className="muted">Cargando proyectos…</p>}
                {projects && visibleProjects.length === 0 && <p className="muted">Ningún proyecto coincide.</p>}
                {visibleProjects.map((p) => (
                  <label key={p.key} className={`project-row${p.key === projectKey ? ' selected' : ''}`}>
                    <input type="radio" name="project" checked={p.key === projectKey} onChange={() => setProjectKey(p.key)} />
                    <span className="key">{p.key}</span>
                    <span>{p.name}</span>
                    <span className="muted small">{p.projectTypeKey}</span>
                  </label>
                ))}
              </div>
              {projectKey && (
                <label>
                  Tablero
                  <select value={boardId ?? ''} onChange={(e) => setBoardId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Sin tablero</option>
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.type})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="actions">
                <button className="primary" disabled={!projectKey} onClick={() => setStep('fields')}>
                  Siguiente
                </button>
              </div>
            </div>
          )}

          {step === 'fields' && (
            <div className="form">
              <p>
                Proyecto <strong>{projectKey}</strong>. Elige en qué campos de Jira se escribirán las fechas planificadas del Planificador.
              </p>
              <label>
                Fecha de inicio planificada
                <select value={startField ?? ''} onChange={(e) => setStartField(e.target.value || null)}>
                  <option value="">No escribir la fecha de inicio</option>
                  {(fields ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} {f.custom ? `(${f.id})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fecha de fin planificada
                <select value={dueField} onChange={(e) => setDueField(e.target.value)}>
                  <option value="duedate">Fecha de vencimiento (duedate)</option>
                  {(fields ?? [])
                    .filter((f) => f.id !== 'duedate')
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} {f.custom ? `(${f.id})` : ''}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted small">
                {!fields && !error ? 'Cargando campos…' : 'Las fechas se envían a Jira solo cuando lo pidas desde la app; nunca de forma automática.'}
              </p>
              <div className="actions">
                <button onClick={() => setStep('project')}>Atrás</button>
                <button className="primary" disabled={!fields} onClick={finish}>
                  Vincular proyecto
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
