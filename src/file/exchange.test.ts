import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { WorkCalendar, defaultCalendar } from '../engine/calendar';
import { schedule } from '../engine/schedule';
import { takeBaseline } from '../engine/tracking';
import type { Project, Task } from '../model/types';
import { exportMspdi, importMspdi, parseDuration } from './mspdi';
import { taskRows, toCsv, toXlsx } from './tabular';

function task(id: string, name: string, durationDays: number, level = 0, extra: Partial<Task> = {}): Task {
  return { id, name, level, durationDays, constraint: { type: 'ASAP', date: null }, percentComplete: 0, actualStart: null, actualFinish: null, notes: '', ...extra };
}

function sample(): Project {
  const p: Project = {
    id: 'p',
    name: 'Bodega',
    start: '2026-11-02',
    statusDate: '2026-11-13',
    baseline: null,
    calendarId: 'cal-std',
    calendars: [defaultCalendar()],
    tasks: [
      task('s', 'Fase 1', 0, 0),
      task('a', 'Topografía', 3, 1, { percentComplete: 100, actualStart: '2026-11-02', actualFinish: '2026-11-04' }),
      task('b', 'Diseño "A" & B', 10, 1, { constraint: { type: 'SNET', date: '2026-11-09' }, notes: 'Con <notas>' }),
      task('m', 'Hito', 0, 1),
      task('c', 'Obra', 5, 0),
    ],
    dependencies: [
      { id: 'd1', from: 'a', to: 'b', type: 'FS', lagDays: 2 },
      { id: 'd2', from: 'b', to: 'm', type: 'FS', lagDays: 0 },
      { id: 'd3', from: 'b', to: 'c', type: 'SS', lagDays: -1 },
    ],
    resources: [
      { id: 'r1', name: 'Arquitecta', type: 'work', initials: 'A', maxUnits: 1, costPerHour: 28000, notes: '' },
      { id: 'r2', name: 'Hormigón', type: 'material', initials: 'H', maxUnits: 1, costPerHour: 95000, notes: '' },
    ],
    assignments: [
      { id: 'x1', taskId: 'b', resourceId: 'r1', units: 0.5 },
      { id: 'x2', taskId: 'c', resourceId: 'r2', units: 1 },
    ],
  };
  p.baseline = takeBaseline(schedule(p));
  return p;
}

describe('XML de MS Project', () => {
  it('interpreta duraciones de Project', () => {
    expect(parseDuration('PT40H0M0S')).toBe(5);
    expect(parseDuration('PT0H0M0S')).toBe(0);
    expect(parseDuration('PT12H0M0S')).toBe(2);
  });

  it('exporta e importa sin perder tareas, vínculos, recursos ni línea base', () => {
    const p = sample();
    const xml = exportMspdi(p);
    expect(xml).toContain('<Name>Diseño &quot;A&quot; &amp; B</Name>');
    const q = importMspdi(xml);
    expect(q.name).toBe('Bodega');
    expect(q.start).toBe('2026-11-02');
    expect(q.statusDate).toBe('2026-11-13');
    expect(q.tasks.map((t) => [t.name, t.level, t.durationDays])).toEqual([
      ['Fase 1', 0, 0],
      ['Topografía', 1, 3],
      ['Diseño "A" & B', 1, 10],
      ['Hito', 1, 0],
      ['Obra', 0, 5],
    ]);
    expect(q.tasks[2].constraint).toEqual({ type: 'SNET', date: '2026-11-09' });
    expect(q.tasks[2].notes).toBe('Con <notas>');
    expect(q.tasks[1]).toMatchObject({ percentComplete: 100, actualStart: '2026-11-02', actualFinish: '2026-11-04' });
    const row = (id: string) => q.tasks.findIndex((t) => t.id === id) + 1;
    const links = q.dependencies.map((d) => [row(d.from), row(d.to), d.type, d.lagDays]);
    expect(links).toEqual([
      [2, 3, 'FS', 2],
      [3, 4, 'FS', 0],
      [3, 5, 'SS', -1],
    ]);
    expect(q.resources.map((r) => [r.name, r.type, r.costPerHour])).toEqual([
      ['Arquitecta', 'work', 28000],
      ['Hormigón', 'material', 95000],
    ]);
    expect(q.assignments).toHaveLength(2);
    expect(q.assignments[0].units).toBe(0.5);
    expect(q.baseline).not.toBeNull();
    expect(q.baseline!.tasks[q.tasks[2].id]).toMatchObject({ start: '2026-11-09', durationDays: 10 });
    expect(q.calendars[0].holidays.some((h) => h.date === '2026-12-25')).toBe(true);
    expect(q.calendars[0].workDays).toEqual([1, 2, 3, 4, 5]);
    // Las fechas calculadas coinciden con las del proyecto original.
    const a = schedule(p);
    const b = schedule(q);
    expect(b.order.map((t) => [t.start, t.finish])).toEqual(a.order.map((t) => [t.start, t.finish]));
  });

  it('importa un XML mínimo escrito por Project (con tarea resumen UID 0 y excepciones antiguas)', () => {
    const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Name>Mínimo</Name><StartDate>2026-03-02T08:00:00</StartDate><CalendarUID>1</CalendarUID>
<Calendars><Calendar><UID>1</UID><Name>Estándar</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>
<WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay><WeekDay><DayType>2</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>3</DayType><DayWorking>1</DayWorking></WeekDay>
<WeekDay><DayType>4</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>5</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>6</DayType><DayWorking>1</DayWorking></WeekDay><WeekDay><DayType>7</DayType><DayWorking>1</DayWorking></WeekDay>
<WeekDay><DayType>0</DayType><DayWorking>0</DayWorking><TimePeriod><FromDate>2026-03-05T00:00:00</FromDate><ToDate>2026-03-06T23:59:00</ToDate></TimePeriod></WeekDay>
</WeekDays></Calendar></Calendars>
<Tasks><Task><UID>0</UID><ID>0</ID><Name>Mínimo</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
<Task><UID>1</UID><ID>1</ID><Name>Uno</Name><OutlineLevel>1</OutlineLevel><Duration>PT16H0M0S</Duration><Milestone>0</Milestone><Summary>0</Summary></Task>
<Task><UID>2</UID><ID>2</ID><Name>Dos</Name><OutlineLevel>1</OutlineLevel><Duration>PT8H0M0S</Duration><PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink></Task>
</Tasks></Project>`;
    const q = importMspdi(xml);
    expect(q.tasks.map((t) => t.name)).toEqual(['Uno', 'Dos']);
    expect(q.calendars[0].workDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(q.calendars[0].holidays.map((h) => h.date)).toEqual(['2026-03-05', '2026-03-06']);
    const r = schedule(q);
    // Uno: lun 2 y mar 3; Dos: mié 4 (jueves y viernes son excepción, no afectan).
    expect(r.tasks.get(q.tasks[1].id)!.start).toBe('2026-03-04');
  });

  it('rechaza un XML que no es de Project', () => {
    expect(() => importMspdi('<Otro/>')).toThrow(/Project/);
  });
});

describe('Excel y CSV', () => {
  const p = sample();
  const rows = taskRows(p, schedule(p), new WorkCalendar(defaultCalendar()));

  it('arma la tabla con sangría, predecesoras y línea base', () => {
    expect(rows[0]).toContain('Comienzo línea base');
    expect(rows[3][2]).toBe('  Diseño "A" & B');
    expect(rows[3][6]).toBe('2+2d');
    expect(rows[5][6]).toBe('3CC-1d');
  });

  it('escribe CSV con punto y coma, BOM y comillas donde hace falta', () => {
    const csv = toCsv(rows);
    expect(csv.startsWith('﻿Id;EDT;Nombre de tarea')).toBe(true);
    expect(csv).toContain('"  Diseño ""A"" & B"');
  });

  it('genera un .xlsx válido con la hoja de tareas', () => {
    const files = unzipSync(toXlsx(rows));
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<t xml:space="preserve">Nombre de tarea</t>');
    expect(sheet).toContain('<c r="D3"><v>3</v></c>');
    expect(sheet).toContain('Diseño &quot;A&quot; &amp; B'.replace('&quot;', '"').replace('&quot;', '"'));
  });
});
