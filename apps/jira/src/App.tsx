import { useEffect } from 'react';
import { AppShell, BASE_VIEWS, Menu, Toolbar, useProject, type View } from '@planificador/core';
import { ConnectDialog } from './jira/ConnectDialog';
import { JiraView } from './jira/JiraView';
import { AlignView } from './jira/AlignView';
import { useJira } from './jira/store';

// En desarrollo (navegador) se exponen los estados para poder simular una conexión desde la consola o pruebas.
if (import.meta.env.DEV) Object.assign(window, { __jira: useJira, __project: useProject });

const VIEWS: [View, string][] = [...BASE_VIEWS, ['align', 'Alinear'], ['jira', 'Jira']];

export default function App() {
  const j = useJira();
  const setView = useProject((s) => s.setView);
  const link = useProject((s) => s.project.jira) ?? null;

  useEffect(() => {
    void useJira.getState().init();
  }, []);

  const jiraMenu = (
    <Menu label="Jira">
      {j.status === 'connected' ? (
        <>
          <button onClick={() => j.setShowConnect(true)}>{link ? 'Cambiar proyecto vinculado…' : 'Vincular con un proyecto de Jira…'}</button>
          <button onClick={() => setView('align')}>Alinear tareas con incidencias</button>
          <button onClick={() => setView('jira')}>Ver incidencias</button>
          <button
            onClick={() => {
              if (window.confirm('¿Cerrar la sesión de Jira y borrar el token guardado en este computador?')) void j.disconnect();
            }}
          >
            Cerrar sesión de Jira
          </button>
        </>
      ) : (
        <button onClick={() => j.setShowConnect(true)}>Conectar con Jira…</button>
      )}
    </Menu>
  );

  const statusText =
    j.status === 'connected'
      ? `Jira: ${j.user?.displayName ?? j.account?.email}${link ? ` · ${link.projectKey}` : ' · sin proyecto vinculado'}`
      : j.status === 'connecting'
        ? 'Jira: conectando…'
        : j.status === 'error'
          ? 'Jira: error de conexión'
          : 'Jira: sin conectar';

  return (
    <>
      <AppShell
        toolbar={<Toolbar views={VIEWS} extra={jiraMenu} />}
        views={{ jira: () => <JiraView />, align: (result) => <AlignView result={result} /> }}
        status={
          <span className="jira-status" title={j.error ?? 'Clic para conectar o cambiar el proyecto vinculado'} onClick={() => j.setShowConnect(true)}>
            {statusText}
          </span>
        }
      />
      {j.showConnect && <ConnectDialog onClose={() => j.setShowConnect(false)} />}
    </>
  );
}
