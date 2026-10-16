import type { Calendar, ISODate } from '../model/types';

/** Convierte 'YYYY-MM-DD' a Date en UTC (evita problemas de zona horaria). */
export function parseDate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

export function today(): ISODate {
  const now = new Date();
  return formatDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/** Diferencia en días calendario (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export class WorkCalendar {
  private readonly workDays: Set<number>;
  private readonly holidays: Set<ISODate>;

  constructor(cal: Calendar) {
    this.workDays = new Set(cal.workDays);
    this.holidays = new Set(cal.holidays.map((h) => h.date));
  }

  isWorkingDay(iso: ISODate): boolean {
    if (this.holidays.has(iso)) return false;
    return this.workDays.has(parseDate(iso).getUTCDay());
  }

  /** Primer día laboral en o después de `iso`. */
  nextWorkingDay(iso: ISODate): ISODate {
    let d = iso;
    let guard = 0;
    while (!this.isWorkingDay(d) && guard++ < 3660) d = addDays(d, 1);
    return d;
  }

  /** Último día laboral en o antes de `iso`. */
  prevWorkingDay(iso: ISODate): ISODate {
    let d = iso;
    let guard = 0;
    while (!this.isWorkingDay(d) && guard++ < 3660) d = addDays(d, -1);
    return d;
  }

  /**
   * Avanza `n` días laborales desde `iso` (que debe ser laboral).
   * n = 0 devuelve el mismo día; n puede ser negativo.
   */
  addWorkingDays(iso: ISODate, n: number): ISODate {
    let d = this.isWorkingDay(iso) ? iso : n >= 0 ? this.nextWorkingDay(iso) : this.prevWorkingDay(iso);
    const step = n >= 0 ? 1 : -1;
    let remaining = Math.abs(n);
    while (remaining > 0) {
      d = addDays(d, step);
      if (this.isWorkingDay(d)) remaining--;
    }
    return d;
  }

  /** Cantidad de días laborales en el intervalo cerrado [a, b]. */
  workingDaysBetween(a: ISODate, b: ISODate): number {
    if (a > b) return 0;
    let count = 0;
    let d = a;
    while (d <= b) {
      if (this.isWorkingDay(d)) count++;
      d = addDays(d, 1);
    }
    return count;
  }
}

/** Feriados de Chile precargados como sugerencia (irrenunciables y nacionales). */
export const FERIADOS_CHILE_2026: { date: ISODate; name: string }[] = [
  { date: '2026-01-01', name: 'Año Nuevo' },
  { date: '2026-04-03', name: 'Viernes Santo' },
  { date: '2026-04-04', name: 'Sábado Santo' },
  { date: '2026-05-01', name: 'Día del Trabajo' },
  { date: '2026-05-21', name: 'Glorias Navales' },
  { date: '2026-06-21', name: 'Pueblos Indígenas' },
  { date: '2026-06-29', name: 'San Pedro y San Pablo' },
  { date: '2026-07-16', name: 'Virgen del Carmen' },
  { date: '2026-08-15', name: 'Asunción de la Virgen' },
  { date: '2026-09-18', name: 'Independencia Nacional' },
  { date: '2026-09-19', name: 'Glorias del Ejército' },
  { date: '2026-10-12', name: 'Encuentro de Dos Mundos' },
  { date: '2026-10-31', name: 'Iglesias Evangélicas' },
  { date: '2026-11-01', name: 'Todos los Santos' },
  { date: '2026-12-08', name: 'Inmaculada Concepción' },
  { date: '2026-12-25', name: 'Navidad' },
];

export function defaultCalendar(): Calendar {
  return {
    id: 'cal-std',
    name: 'Estándar',
    workDays: [1, 2, 3, 4, 5],
    holidays: [...FERIADOS_CHILE_2026],
  };
}
