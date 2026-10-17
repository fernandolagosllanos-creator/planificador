import { XMLParser } from 'fast-xml-parser';
import { addDays } from '../engine/calendar';
import { computeWbs, schedule } from '../engine/schedule';
import type { Assignment, Baseline, Calendar, ConstraintType, Dependency, DependencyType, ISODate, Project, Resource, Task } from '../model/types';
import { HOURS_PER_DAY } from '../model/types';

/**
 * Intercambio con Microsoft Project mediante su formato XML (MSPDI).
 * Es el formato que Project ofrece en "Guardar como → XML" y "Abrir".
 */

const CONSTRAINT_CODE: Record<ConstraintType, number> = { ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };
const CODE_CONSTRAINT: Record<number, ConstraintType> = { 0: 'ASAP', 1: 'ALAP', 2: 'MSO', 3: 'MFO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT' };
const LINK_CODE: Record<DependencyType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const CODE_LINK: Record<number, DependencyType> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };
/** Retrasos en décimas de minuto, como los guarda Project. */
const LAG_UNITS_PER_DAY = HOURS_PER_DAY * 60 * 10;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const startOf = (iso: ISODate) => `${iso}T08:00:00`;
const endOf = (iso: ISODate) => `${iso}T17:00:00`;
const durationOf = (days: number) => `PT${days * HOURS_PER_DAY}H0M0S`;
const tag = (name: string, value: string | number | null | undefined) => (value === null || value === undefined ? '' : `<${name}>${typeof value === 'string' ? esc(value) : value}</${name}>`);

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

export function exportMspdi(project: Project): string {
  const result = schedule(project);
  const wbs = computeWbs(project.tasks);
  const taskUid = new Map(project.tasks.map((t, i) => [t.id, i + 1]));
  const resUid = new Map(project.resources.map((r, i) => [r.id, i + 1]));
  const cal = project.calendars.find((c) => c.id === project.calendarId) ?? project.calendars[0];
  const now = new Date().toISOString().slice(0, 19);

  const weekDays = [0, 1, 2, 3, 4, 5, 6]
    .map((dow) => {
      const working = cal.workDays.includes(dow);
      const times = working
        ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>'
        : '';
      return `<WeekDay><DayType>${dow + 1}</DayType><DayWorking>${working ? 1 : 0}</DayWorking>${times}</WeekDay>`;
    })
    .join('');
  const exceptions = cal.holidays
    .map(
      (h) =>
        `<Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${h.date}T00:00:00</FromDate><ToDate>${h.date}T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences>${tag('Name', h.name)}<Type>1</Type><DayWorking>0</DayWorking></Exception>`,
    )
    .join('');

  const tasks = project.tasks
    .map((t, i) => {
      const s = result.tasks.get(t.id)!;
      const preds = project.dependencies
        .filter((d) => d.to === t.id && taskUid.has(d.from))
        .map(
          (d) =>
            `<PredecessorLink><PredecessorUID>${taskUid.get(d.from)}</PredecessorUID><Type>${LINK_CODE[d.type]}</Type><CrossProject>0</CrossProject><LinkLag>${Math.round(d.lagDays * LAG_UNITS_PER_DAY)}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`,
        )
        .join('');
      const b = project.baseline?.tasks[t.id];
      const baseline = b
        ? `<Baseline><Number>0</Number><Start>${startOf(b.start)}</Start><Finish>${endOf(b.finish)}</Finish><Duration>${durationOf(b.durationDays)}</Duration><DurationFormat>7</DurationFormat></Baseline>`
        : '';
      return [
        '<Task>',
        tag('UID', i + 1),
        tag('ID', i + 1),
        tag('Name', t.name),
        tag('Active', 1),
        tag('Manual', 0),
        tag('Type', 1),
        tag('IsNull', 0),
        tag('CreateDate', now),
        tag('WBS', wbs.get(t.id)),
        tag('OutlineNumber', wbs.get(t.id)),
        tag('OutlineLevel', t.level + 1),
        tag('Priority', 500),
        tag('Start', startOf(s.start)),
        tag('Finish', endOf(s.finish)),
        tag('Duration', durationOf(s.durationDays)),
        tag('DurationFormat', 7),
        tag('Estimated', 0),
        tag('Milestone', s.isMilestone ? 1 : 0),
        tag('Summary', s.isSummary ? 1 : 0),
        tag('Critical', s.isCritical ? 1 : 0),
        tag('PercentComplete', s.percentComplete),
        tag('PercentWorkComplete', s.percentComplete),
        tag('ConstraintType', CONSTRAINT_CODE[t.constraint?.type ?? 'ASAP']),
        t.constraint?.date ? tag('ConstraintDate', startOf(t.constraint.date)) : '',
        tag('CalendarUID', -1),
        t.actualStart ? tag('ActualStart', startOf(t.actualStart)) : '',
        t.actualFinish ? tag('ActualFinish', endOf(t.actualFinish)) : '',
        tag('TotalSlack', s.slackDays * HOURS_PER_DAY * 60 * 10),
        t.notes ? tag('Notes', t.notes) : '',
        baseline,
        preds,
        '</Task>',
      ].join('');
    })
    .join('');

  const resources = project.resources
    .map((r, i) =>
      [
        '<Resource>',
        tag('UID', i + 1),
        tag('ID', i + 1),
        tag('Name', r.name),
        tag('Type', r.type === 'work' ? 1 : 0),
        tag('IsNull', 0),
        tag('Initials', r.initials),
        tag('MaxUnits', r.maxUnits),
        tag('StandardRate', r.costPerHour),
        tag('StandardRateFormat', r.type === 'work' ? 2 : 8),
        tag('CalendarUID', 1),
        r.notes ? tag('Notes', r.notes) : '',
        '</Resource>',
      ].join(''),
    )
    .join('');

  const assignments = project.assignments
    .filter((a) => taskUid.has(a.taskId) && resUid.has(a.resourceId))
    .map((a, i) => `<Assignment><UID>${i + 1}</UID><TaskUID>${taskUid.get(a.taskId)}</TaskUID><ResourceUID>${resUid.get(a.resourceId)}</ResourceUID><Units>${a.units}</Units></Assignment>`)
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    tag('SaveVersion', 14),
    tag('Name', project.name),
    tag('Title', project.name),
    tag('CreationDate', now),
    tag('LastSaved', now),
    tag('ScheduleFromStart', 1),
    tag('StartDate', startOf(result.projectStart)),
    tag('FinishDate', endOf(result.projectFinish)),
    tag('FYStartDate', 1),
    tag('CriticalSlackLimit', 0),
    tag('CurrencyDigits', 0),
    tag('CurrencySymbol', '$'),
    tag('CurrencyCode', 'CLP'),
    tag('CalendarUID', 1),
    tag('DefaultStartTime', '08:00:00'),
    tag('DefaultFinishTime', '17:00:00'),
    tag('MinutesPerDay', HOURS_PER_DAY * 60),
    tag('MinutesPerWeek', HOURS_PER_DAY * 60 * 5),
    tag('DaysPerMonth', 20),
    tag('DurationFormat', 7),
    tag('WorkFormat', 2),
    tag('NewTasksAreManual', 0),
    project.statusDate ? tag('StatusDate', endOf(project.statusDate)) : '',
    tag('CurrentDate', now),
    `<Calendars><Calendar><UID>1</UID>${tag('Name', cal.name)}<IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${weekDays}</WeekDays><Exceptions>${exceptions}</Exceptions></Calendar></Calendars>`,
    `<Tasks>${tasks}</Tasks>`,
    `<Resources>${resources}</Resources>`,
    `<Assignments>${assignments}</Assignments>`,
    '</Project>',
  ].join('');
}

// ---------------------------------------------------------------------------
// Importar
// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const num = (v: unknown, dflt = 0): number => {
  const n = parseFloat(str(v));
  return Number.isNaN(n) ? dflt : n;
};
const date = (v: unknown): ISODate | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v));
  return m ? m[1] : null;
};
const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v && typeof v === 'object' ? [v as Node] : []);

/** "PT40H0M0S" → días laborales (8 horas por día). */
export function parseDuration(text: string): number {
  const m = /^PT(\d+)H(\d+)M(\d+)S$/i.exec(text.trim());
  if (!m) return 0;
  const hours = parseInt(m[1], 10) + parseInt(m[2], 10) / 60 + parseInt(m[3], 10) / 3600;
  return Math.round(hours / HOURS_PER_DAY);
}

function importCalendar(node: Node | undefined): Calendar {
  const cal: Calendar = { id: 'cal-std', name: str(node?.Name) || 'Estándar', workDays: [1, 2, 3, 4, 5], holidays: [] };
  if (!node) return cal;
  const weekDays = arr((node.WeekDays as Node | undefined)?.WeekDay);
  const workDays: number[] = [];
  let hasWeek = false;
  const addRange = (from: ISODate | null, to: ISODate | null, name: string) => {
    if (!from) return;
    const end = to && to >= from ? to : from;
    for (let d = from, n = 0; d <= end && n < 366; d = addDays(d, 1), n++) cal.holidays.push({ date: d, name });
  };
  for (const w of weekDays) {
    const type = num(w.DayType);
    const working = num(w.DayWorking) === 1;
    if (type >= 1 && type <= 7) {
      hasWeek = true;
      if (working) workDays.push(type - 1);
    } else if (type === 0 && !working) {
      const tp = w.TimePeriod as Node | undefined;
      addRange(date(tp?.FromDate), date(tp?.ToDate), 'Excepción');
    }
  }
  if (hasWeek) cal.workDays = workDays;
  for (const e of arr((node.Exceptions as Node | undefined)?.Exception)) {
    if (num(e.DayWorking) === 1) continue;
    const tp = e.TimePeriod as Node | undefined;
    addRange(date(tp?.FromDate), date(tp?.ToDate), str(e.Name) || 'Excepción');
  }
  const seen = new Set<string>();
  cal.holidays = cal.holidays.filter((h) => (seen.has(h.date) ? false : (seen.add(h.date), true))).sort((a, b) => a.date.localeCompare(b.date));
  return cal;
}

export function importMspdi(xml: string): Project {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    isArray: (name) => ['Task', 'Resource', 'Assignment', 'PredecessorLink', 'Calendar', 'WeekDay', 'Exception', 'Baseline', 'WorkingTime'].includes(name),
  });
  const doc = parser.parse(xml) as Node;
  const root = doc.Project as Node | undefined;
  if (!root) throw new Error('El archivo no es un XML de Microsoft Project (falta el elemento Project)');

  const calendars = arr((root.Calendars as Node | undefined)?.Calendar);
  const calUid = str(root.CalendarUID);
  const baseCal = calendars.find((c) => str(c.UID) === calUid) ?? calendars.find((c) => num(c.IsBaseCalendar) === 1) ?? calendars[0];
  const calendar = importCalendar(baseCal);

  const rawTasks = arr((root.Tasks as Node | undefined)?.Task).filter((t) => num(t.IsNull) !== 1 && str(t.UID) !== '0' && num(t.OutlineLevel, 1) >= 1);
  const uidToId = new Map<string, string>();
  const tasks: Task[] = rawTasks.map((t) => {
    const id = newId();
    uidToId.set(str(t.UID), id);
    const milestone = num(t.Milestone) === 1;
    const summary = num(t.Summary) === 1;
    const code = num(t.ConstraintType);
    const ctype = CODE_CONSTRAINT[code] ?? 'ASAP';
    const cdate = ctype === 'ASAP' || ctype === 'ALAP' ? null : date(t.ConstraintDate);
    return {
      id,
      name: str(t.Name) || 'Tarea sin nombre',
      level: Math.max(0, num(t.OutlineLevel, 1) - 1),
      durationDays: milestone || summary ? 0 : Math.max(0, parseDuration(str(t.Duration))),
      constraint: { type: cdate || !((ctype as string) in { SNET: 1, SNLT: 1, FNET: 1, FNLT: 1, MSO: 1, MFO: 1 }) ? ctype : 'ASAP', date: cdate },
      percentComplete: Math.max(0, Math.min(100, Math.round(num(t.PercentComplete)))),
      actualStart: summary ? null : date(t.ActualStart),
      actualFinish: summary ? null : date(t.ActualFinish),
      notes: str(t.Notes),
    };
  });

  const dependencies: Dependency[] = [];
  const baselineTasks: Baseline['tasks'] = {};
  rawTasks.forEach((t, i) => {
    const to = tasks[i].id;
    for (const l of arr(t.PredecessorLink)) {
      const from = uidToId.get(str(l.PredecessorUID));
      if (!from || from === to) continue;
      dependencies.push({ id: newId(), from, to, type: CODE_LINK[num(l.Type, 1)] ?? 'FS', lagDays: Math.round(num(l.LinkLag) / LAG_UNITS_PER_DAY) });
    }
    const b = arr(t.Baseline).find((x) => num(x.Number) === 0);
    const bs = date(b?.Start);
    const bf = date(b?.Finish);
    if (b && bs && bf) baselineTasks[to] = { start: bs, finish: bf, durationDays: parseDuration(str(b.Duration)) };
  });

  const resUidToId = new Map<string, string>();
  const resources: Resource[] = arr((root.Resources as Node | undefined)?.Resource)
    .filter((r) => num(r.IsNull) !== 1 && str(r.UID) !== '0' && str(r.Name))
    .map((r) => {
      const id = newId();
      resUidToId.set(str(r.UID), id);
      const name = str(r.Name);
      return {
        id,
        name,
        type: num(r.Type, 1) === 0 ? 'material' : 'work',
        initials: str(r.Initials) || name.slice(0, 1).toUpperCase(),
        maxUnits: num(r.MaxUnits, 1),
        costPerHour: num(r.StandardRate),
        notes: str(r.Notes),
      };
    });

  const assignments: Assignment[] = arr((root.Assignments as Node | undefined)?.Assignment)
    .map((a) => ({ id: newId(), taskId: uidToId.get(str(a.TaskUID)) ?? '', resourceId: resUidToId.get(str(a.ResourceUID)) ?? '', units: num(a.Units, 1) }))
    .filter((a) => a.taskId && a.resourceId);

  const start = date(root.StartDate) ?? tasks.map((t) => t.constraint.date ?? '').filter(Boolean).sort()[0] ?? new Date().toISOString().slice(0, 10);
  return {
    id: newId(),
    name: str(root.Name) || str(root.Title) || 'Proyecto importado',
    start,
    statusDate: date(root.StatusDate),
    baseline: Object.keys(baselineTasks).length ? { savedAt: new Date().toISOString(), tasks: baselineTasks } : null,
    calendarId: calendar.id,
    calendars: [calendar],
    tasks: tasks.length ? tasks : [{ id: newId(), name: 'Tarea 1', level: 0, durationDays: 1, constraint: { type: 'ASAP', date: null }, percentComplete: 0, actualStart: null, actualFinish: null, notes: '' }],
    dependencies,
    resources,
    assignments,
  };
}
