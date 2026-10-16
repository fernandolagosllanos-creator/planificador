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

  /**
   * Días laborales que hay que avanzar desde `a` para llegar a `b`: cuenta los
   * días laborales en (a, b]. Negativo si `b` es anterior a `a`.
   */
  workingDaysDiff(a: ISODate, b: ISODate): number {
    if (a === b) return 0;
    if (b < a) return -this.workingDaysDiff(b, a);
    return this.workingDaysBetween(addDays(a, 1), b);
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

/**
 * Feriados nacionales de Chile, precargados como sugerencia. Incluyen los
 * traslados a lunes (San Pedro y San Pablo, Encuentro de Dos Mundos) y el de
 * Iglesias Evangélicas a viernes. Los feriados por elecciones no están: se
 * agregan a mano cuando se decretan.
 */
export const FERIADOS_CHILE: { date: ISODate; name: string }[] = [
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
  { date: '2027-01-01', name: 'Año Nuevo' },
  { date: '2027-03-26', name: 'Viernes Santo' },
  { date: '2027-03-27', name: 'Sábado Santo' },
  { date: '2027-05-01', name: 'Día del Trabajo' },
  { date: '2027-05-21', name: 'Glorias Navales' },
  { date: '2027-06-21', name: 'Pueblos Indígenas' },
  { date: '2027-06-28', name: 'San Pedro y San Pablo' },
  { date: '2027-07-16', name: 'Virgen del Carmen' },
  { date: '2027-08-15', name: 'Asunción de la Virgen' },
  { date: '2027-09-18', name: 'Independencia Nacional' },
  { date: '2027-09-19', name: 'Glorias del Ejército' },
  { date: '2027-10-11', name: 'Encuentro de Dos Mundos' },
  { date: '2027-10-31', name: 'Iglesias Evangélicas' },
  { date: '2027-11-01', name: 'Todos los Santos' },
  { date: '2027-12-08', name: 'Inmaculada Concepción' },
  { date: '2027-12-25', name: 'Navidad' },
  { date: '2028-01-01', name: 'Año Nuevo' },
  { date: '2028-04-14', name: 'Viernes Santo' },
  { date: '2028-04-15', name: 'Sábado Santo' },
  { date: '2028-05-01', name: 'Día del Trabajo' },
  { date: '2028-05-21', name: 'Glorias Navales' },
  { date: '2028-06-20', name: 'Pueblos Indígenas' },
  { date: '2028-06-26', name: 'San Pedro y San Pablo' },
  { date: '2028-07-16', name: 'Virgen del Carmen' },
  { date: '2028-08-15', name: 'Asunción de la Virgen' },
  { date: '2028-09-18', name: 'Independencia Nacional' },
  { date: '2028-09-19', name: 'Glorias del Ejército' },
  { date: '2028-10-09', name: 'Encuentro de Dos Mundos' },
  { date: '2028-10-27', name: 'Iglesias Evangélicas' },
  { date: '2028-11-01', name: 'Todos los Santos' },
  { date: '2028-12-08', name: 'Inmaculada Concepción' },
  { date: '2028-12-25', name: 'Navidad' },
];

/** Agrega a un calendario los feriados de Chile que todavía no tiene. */
export function withChileHolidays(cal: Calendar): Calendar {
  const have = new Set(cal.holidays.map((h) => h.date));
  const holidays = [...cal.holidays, ...FERIADOS_CHILE.filter((h) => !have.has(h.date))];
  holidays.sort((a, b) => compareDates(a.date, b.date));
  return { ...cal, holidays };
}

export function defaultCalendar(): Calendar {
  return {
    id: 'cal-std',
    name: 'Estándar Chile',
    workDays: [1, 2, 3, 4, 5],
    holidays: [...FERIADOS_CHILE],
  };
}
