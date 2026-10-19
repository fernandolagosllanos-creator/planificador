import { create } from 'zustand';
import { useProject, type JiraLink } from '@planificador/core';
import * as jira from './client';
import { addDependent, removeIssue, setBase, suggestLinks, unlinkTask, type Suggestion } from './links';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface JiraState {
  status: ConnectionStatus;
  account: jira.JiraAccount | null;
  user: jira.JiraUser | null;
  error: string | null;
  issues: jira.JiraIssue[];
  loadingIssues: boolean;
  showConnect: boolean;

  /** Al iniciar: si hay credenciales en el llavero, comprueba la sesión. */
  init: () => Promise<void>;
  connect: (site: string, email: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setShowConnect: (show: boolean) => void;
  /** Guarda (o quita) el vínculo del proyecto abierto con un proyecto de Jira. */
  linkProject: (link: JiraLink | null) => void;
  refreshIssues: () => Promise<void>;

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
    set({ status: 'disconnected', account: null, user: null, error: null, issues: [] });
  },

  setShowConnect: (showConnect) => set({ showConnect }),

  linkProject: (link) => {
    useProject.getState().mutate((p) => void (p.jira = link));
    set({ issues: [] });
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
      const issues = await jira.listIssues({ projectKey: link.projectKey, startDateField: link.startDateField, dueDateField: link.dueDateField });
      set({ issues, loadingIssues: false });
    } catch (e) {
      set({ loadingIssues: false });
      useProject.getState().setError(`No se pudieron leer las incidencias de Jira: ${(e as Error).message}`);
    }
  },
}));
