import { strToU8, zipSync } from 'fflate';
import type { WorkCalendar } from '../engine/calendar';
import { formatResourceNames } from '../engine/resources';
import type { ScheduleResult } from '../engine/schedule';
import { computeWbs, formatPredecessors } from '../engine/schedule';
import { varianceOf } from '../engine/tracking';
import type { Project } from '../model/types';

/** Exportación de la tabla de tareas a CSV (para Excel) y a .xlsx. */

export type Cell = string | number;

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** Filas de la tabla de tareas: encabezado y una fila por tarea, con sangría en el nombre. */
export function taskRows(project: Project, result: ScheduleResult, cal: WorkCalendar): Cell[][] {
  const wbs = computeWbs(project.tasks);
  const header: Cell[] = ['Id', 'EDT', 'Nombre de tarea', 'Duración (d)', 'Comienzo', 'Fin', 'Predecesoras', '% completado', 'Recursos', 'Holgura (d)', 'Crítica'];
  if (project.baseline) header.push('Comienzo línea base', 'Fin línea base', 'Variación fin (d)');
  const rows: Cell[][] = [header];
  for (const t of project.tasks) {
    const s = result.tasks.get(t.id)!;
    const row: Cell[] = [
      s.row,
      wbs.get(t.id) ?? '',
      `${'  '.repeat(t.level)}${t.name}`,
      s.durationDays,
      fmt(s.start),
      fmt(s.finish),
      formatPredecessors(project, t.id),
      s.percentComplete,
      formatResourceNames(project, t.id).replace(/;/g, '; '),
      s.isSummary ? '' : s.slackDays,
      s.isCritical ? 'Sí' : 'No',
    ];
    if (project.baseline) {
      const v = varianceOf(s, project.baseline, cal);
      row.push(v ? fmt(v.baselineStart) : '', v ? fmt(v.baselineFinish) : '', v ? v.finishVariance : '');
    }
    rows.push(row);
  }
  return rows;
}

/** CSV con separador ";" y BOM, que Excel en español abre directamente con columnas. */
export function toCsv(rows: Cell[][]): string {
  const cell = (c: Cell) => {
    const s = typeof c === 'number' ? String(c).replace('.', ',') : c;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Libro .xlsx mínimo (una hoja) construido a mano: sin dependencias y lo abre cualquier Excel. */
export function toXlsx(rows: Cell[][], sheetName = 'Tareas'): Uint8Array {
  const widths = rows[0].map((_, i) => Math.min(60, Math.max(8, ...rows.map((r) => String(r[i] ?? '').length + 2))));
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const sheetRows = rows
    .map((r, ri) => {
      const cells = r
        .map((c, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          if (typeof c === 'number') return `<c r="${ref}"${ri === 0 ? ' s="1"' : ''}><v>${c}</v></c>`;
          if (c === '') return '';
          return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/></cellXfs></styleSheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  return zipSync(
    {
      '[Content_Types].xml': strToU8(types),
      '_rels/.rels': strToU8(rels),
      'xl/workbook.xml': strToU8(workbook),
      'xl/_rels/workbook.xml.rels': strToU8(wbRels),
      'xl/styles.xml': strToU8(styles),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    },
    { level: 6 },
  );
}
