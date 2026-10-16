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

/**
 * Restricciones de programación, con los mismos tipos que Microsoft Project:
 * ASAP lo antes posible, ALAP lo más tarde posible, SNET no comenzar antes del,
 * SNLT no comenzar después del, FNET no finalizar antes del, FNLT no finalizar
 * después del, MSO debe comenzar el, MFO debe finalizar el.
 */
export type ConstraintType = 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';

export const CONSTRAINT_LABEL_ES: Record<ConstraintType, string> = {
  ASAP: 'Lo antes posible',
  ALAP: 'Lo más tarde posible',
  SNET: 'No comenzar antes del',
  SNLT: 'No comenzar después del',
  FNET: 'No finalizar antes del',
  FNLT: 'No finalizar después del',
  MSO: 'Debe comenzar el',
  MFO: 'Debe finalizar el',
};

/** Restricciones que necesitan una fecha. */
export const CONSTRAINT_NEEDS_DATE: Record<ConstraintType, boolean> = {
  ASAP: false,
  ALAP: false,
  SNET: true,
  SNLT: true,
  FNET: true,
  FNLT: true,
  MSO: true,
  MFO: true,
};

export interface TaskConstraint {
  type: ConstraintType;
  date: ISODate | null;
}

export interface Task {
  id: string;
  name: string;
  /** Nivel de sangría en la EDT; 0 = raíz. */
  level: number;
  /** Duración en días laborales. 0 = hito. */
  durationDays: number;
  constraint: TaskConstraint;
  percentComplete: number;
  notes: string;
  /** Solo en archivos de esquema 1: inicio fijado a mano. Se migra a una restricción SNET. */
  manualStart?: ISODate | null;
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
  /** Holgura total en días laborales (solo tareas hoja). Negativa si una restricción no se puede cumplir. */
  slackDays: number;
  /** Comienzo y fin más tardíos que no atrasan el proyecto (solo tareas hoja). */
  lateStart: ISODate;
  lateFinish: ISODate;
  isCritical: boolean;
  /** La restricción de la tarea choca con sus predecesoras o con otra restricción. */
  constraintConflict: boolean;
  /** Número de fila (1-based), equivale al "Id" de Project. */
  row: number;
  level: number;
  parentId: string | null;
}

export const PLANIF_FORMAT = 'planif';
export const PLANIF_SCHEMA_VERSION = 2;
