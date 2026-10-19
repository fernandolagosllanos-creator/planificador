import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@planificador/core/styles.css';
import './jira/jira.css';
import { setAppInfo } from '@planificador/core';
import pkg from '../package.json';
import App from './App.tsx';

setAppInfo({ name: 'Planificador Jira', version: pkg.version });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
