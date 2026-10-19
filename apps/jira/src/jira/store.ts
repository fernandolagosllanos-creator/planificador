import { create } from 'zustand';
import { useProject, type JiraLink } from '@planificador/core';
import * as jira from './client';
import { addDependent, removeIssue, setBase, suggestLinks, unlinkTask, type Suggestion } from './links';
import { transitionTo } from './board';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface JiraState {
  status: ConnectionStatus;
  account: jira.JiraAccount | null;
  user: jira.JiraUser | null;
  error: string | null;
  issues: jira.JiraIssue[];
  loadingIssues: boolean;
  /** Estados del proyecto vinculado (columnas del tablero). */
  statuses: jira.JiraStatus[];
  /** Claves de incidencias cuyo cambio de estado está en curso. */
  moving: Set<string>;
  showConnect: boolean;

  /** Al iniciar: si hay credenciales en el llavero, comprueba la sesión. */
  init: () => Promise<void>;
  connect: (site: string, email: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setShowConnect: (show: boolean) => void;
  /** Guarda (o quita) el vínculo del proyecto abierto con un proyecto de Jira. */
  linkProject: (link: JiraLink | null) => void;
  refreshIssues: () => Promise<void>;
  /** Cambia el estado de una incidencia en Jira moviéndola a la columna `target` del tablero. */
  moveIssue: (key: string, target: jira.JiraStatus) => Promise<void>;

  /** Vínculos tarea ↔ incidencia (se guardan en el .planif, con deshacer). */
  setBase: (taskId: string, key: string) => void;
  addDependent: (taskId: string, key: string) => void;
  removeIssue: (key: string) => void;
  unlinkTask: (taskId: string) => void;
  /** Sugerencias por nombre para las tareas hoja sin vincular. */
  suggestions: () => Suggestion[];
  applySuggestions: (list: Suggestion[]) => void;
}

/** Aplica un cambio a la lista de vínculos del proyecto abierto (registrado en deshacer). */
function editLinks(fn: (links: JiraLink['links']) => JiraLink['links']): void {
  const st = useProject.getState();
  if (!st.project.jira) {
    st.setError('Primero vincula este proyecto con un proyecto de Jira (menú Jira).');
    return;
  }
  st.mutate((p) => {
    if (p.jira) p.jira.links = fn(p.jira.links);
  });
}

export const useJira = create<JiraState>((set, get) => ({
  status: 'disconnected',
  account: null,
  user: null,
  error: null,
  issues: [],
  loadingIssues: false,
  statuses: [],
  moving: new Set(),
  showConnect: false,

  init: async () => {
    try {
      const account = await jira.storedAccount();
      if (!account) return;
      set({ status: 'connecting', account, error: null });
      const user = await jira.myself();
      set({ status: 'connected', user });
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
    }
  },

  connect: async (site, email, token) => {
    set({ status: 'connecting', error: null });
    try {
      const user = await jira.connect(site, email, token);
      const account = (await jira.storedAccount()) ?? { site, email };
      set({ status: 'connected', user, account });
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
      throw e;
    }
  },

  disconnect: async () => {
    await jira.forget();
    set({ status: 'disconnected', account: null, user: null, error: null, issues: [], statuses: [] });
  },

  setShowConnect: (showConnect) => set({ showConnect }),

  linkProject: (link) => {
    useProject.getState().mutate((p) => void (p.jira = link));
    set({ issues: [], statuses: [] });
  },

  moveIssue: async (key, target) => {
    const issue = get().issues.find((i) => i.key === key);
    if (!issue || issue.status === target.name || get().moving.has(key)) return;
    const link = useProject.getState().project.jira;
    const setError = useProject.getState().setError;
    set({ moving: new Set([...get().moving, key]) });
    try {
      const transitions = await jira.listTransitions(key);
      const tr = transitionTo(transitions, target);
      if (!tr) {
        const names = transitions.map((t) => `"${t.to.name}"`).join(', ');
        setError(`Jira no permite pasar ${key} de "${issue.status}" a "${target.name}" directamente${names ? ` (solo a ${names})` : ''}.`);
        return;
      }
      if (tr.hasScreen) {
        // La transición pide campos en una pantalla de Jira: se termina allí.
        setError(`La transición "${tr.name}" de ${key} pide datos en Jira; se abre la incidencia en el navegador para completarla.`);
        if (link) window.open(`${link.siteUrl}/browse/${key}`, '_blank');
        return;
      }
      await jira.transitionIssue(key, tr.id);
      set({ issues: get().issues.map((i) => (i.key === key ? { ...i, status: tr.to.name, statusCategory: tr.to.category } : i)) });
    } catch (e) {
      setError(`No se pudo cambiar el estado de ${key}: ${(e as Error).message}`);
    } finally {
      const moving = new Set(get().moving);
      moving.delete(key);
      set({ moving });
    }
  },

  setBase: (taskId, key) => editLinks((links) => setBase(links, taskId, key)),
  addDependent: (taskId, key) => editLinks((links) => addDependent(links, taskId, key)),
  removeIssue: (key) => editLinks((links) => removeIssue(links, key)),
  unlinkTask: (taskId) => editLinks((links) => unlinkTask(links, taskId)),
  suggestions: () => {
    const p = useProject.getState().project;
    return suggestLinks(p.tasks, get().issues, p.jira);
  },
  applySuggestions: (list) =>
    editLinks((links) => {
      let next = links;
      for (const sug of list) next = setBase(next, sug.taskId, sug.key);
      return next;
    }),

  refreshIssues: async () => {
    const link = useProject.getState().project.jira;
    if (!link || get().status !== 'connected') return;
    set({ loadingIssues: true });
    try {
      const [issues, statuses] = await Promise.all([
        jira.listIssues({ projectKey: link.projectKey, startDateField: link.startDateField, dueDateField: link.dueDateField }),
        jira.listStatuses(link.projectKey).catch(() => get().statuses),
      ]);
      set({ issues, statuses, loadingIssues: false });
    } catch (e) {
      set({ loadingIssues: false });
      useProject.getState().setError(`No se pudieron leer las incidencias de Jira: ${(e as Error).message}`);
    }
  },
}));
