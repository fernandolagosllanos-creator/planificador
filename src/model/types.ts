/** Fecha en formato ISO 'YYYY-MM-DD' (granularidad de día para el prototipo). */
export type ISODate = string;

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

/** Abreviaturas en español, como las muestra Microsoft Project en español. */
export const DEP_LABEL_ES: Record<DependencyType, string> = {
  FS: 'FC',
  SS: 'CC',
  FF: 'FF',
  SF: 'CF',
};

export const DEP_FROM_ES: Record<string, DependencyType> = {
  FC: 'FS',
  CC: 'SS',
  FF: 'FF',
  CF: 'SF',
  FS: 'FS',
  SS: 'SS',
  SF: 'SF',
};

export interface Calendar {
  id: string;
  name: string;
  /** Días laborales, 0 = domingo … 6 = sábado. */
  workDays: number[];
  /** Fechas no laborables (feriados). */
  holidays: { date: ISODate; name: string }[];
}

export interface Task {
  id: string;
  name: string;
  /** Nivel de sangría en la EDT; 0 = raíz. */
  level: number;
  /** Duración en días laborales. 0 = hito. */
  durationDays: number;
  /** Inicio fijado por el usuario, usado solo cuando la tarea no tiene predecesoras. */
  manualStart: ISODate | null;
  percentComplete: number;
  notes: string;
}

export interface Dependency {
  id: string;
  /** Tarea predecesora. */
  from: string;
  /** Tarea sucesora. */
  to: string;
  type: DependencyType;
  /** Adelanto (negativo) o retraso (positivo) en días laborales. */
  lagDays: number;
}

export interface Project {
  id: string;
  name: string;
  start: ISODate;
  calendarId: string;
  calendars: Calendar[];
  /** Lista plana en orden de presentación; la jerarquía la da `level`. */
  tasks: Task[];
  dependencies: Dependency[];
}

/** Resultado del cálculo de programación para una tarea. */
export interface ScheduledTask {
  id: string;
  start: ISODate;
  finish: ISODate;
  durationDays: number;
  isSummary: boolean;
  isMilestone: boolean;
  percentComplete: number;
  /** Holgura total en días laborales (solo tareas hoja). */
  slackDays: number;
  isCritical: boolean;
  /** Número de fila (1-based), equivale al "Id" de Project. */
  row: number;
  level: number;
  parentId: string | null;
}

export const PLANIF_FORMAT = 'planif';
export const PLANIF_SCHEMA_VERSION = 1;
