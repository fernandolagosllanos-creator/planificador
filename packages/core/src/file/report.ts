import type { ScheduleResult } from '../engine/schedule';
import type { Project } from '../model/types';

/**
 * Informe imprimible: una página HTML autónoma con la tabla de tareas y la
 * Gantt tal como se ven en pantalla. Se abre en el navegador, donde
 * "Imprimir → Guardar como PDF" produce el PDF.
 */

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Copia las reglas CSS de la aplicación para que el informe se vea igual. */
function appCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText);
    } catch {
      /* hojas de otro origen */
    }
  }
  return out.join('\n');
}

export function buildPrintReport(project: Project, result: ScheduleResult): string {
  const table = document.querySelector('table.task-table')?.outerHTML ?? '';
  const gantt = document.querySelector('svg.gantt')?.outerHTML ?? '';
  const generated = new Date();
  const legend = [
    ['#2563eb', 'Tarea'],
    ['#dc2626', 'Ruta crítica'],
    ['#334155', 'Tarea resumen'],
    ['#94a3b8', 'Línea base'],
    ['#f59e0b', 'Hoy'],
    ['#16a34a', 'Fecha de estado'],
  ]
    .map(([c, l]) => `<span class="lg"><i style="background:${c}"></i>${l}</span>`)
    .join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(project.name)} · Planificador</title>
<style>
${appCss()}
html, body, #root { height: auto; overflow: visible; }
body { background: #fff; padding: 16px 20px; }
.report-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 10px; }
.report-head h1 { font-size: 18px; margin: 0; }
.report-head .meta { color: #64748b; font-size: 12px; }
.report-body { display: flex; align-items: flex-start; }
.report-body .task-table { flex: none; border-right: 2px solid #cbd5e1; }
.report-body svg { flex: none; }
.legend { margin-top: 10px; font-size: 11px; color: #64748b; display: flex; gap: 14px; flex-wrap: wrap; }
.legend i { display: inline-block; width: 14px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
.print-hint { background: #fef3c7; color: #92400e; padding: 6px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 10px; }
.gantt .handle, .gantt .resize { display: none; }
@page { size: A3 landscape; margin: 10mm; }
@media print { .print-hint { display: none; } body { padding: 0; } }
</style>
<script>
// Al imprimir, encoge el contenido para que tabla y Gantt quepan en el ancho de la hoja (A3 horizontal ≈ 1500 px).
window.addEventListener('beforeprint', function () {
  var body = document.querySelector('.report-body');
  body.style.zoom = String(Math.min(1, 1500 / body.scrollWidth));
});
window.addEventListener('afterprint', function () {
  document.querySelector('.report-body').style.zoom = '';
});
</script>
</head>
<body>
<div class="print-hint">Para obtener el PDF: Imprimir (Ctrl+P o ⌘P) → Guardar como PDF. Conviene papel A3 u orientación horizontal.</div>
<div class="report-head">
  <h1>${esc(project.name)}</h1>
  <div class="meta">Inicio ${fmt(result.projectStart)} · Fin ${fmt(result.projectFinish)} · ${project.tasks.length} tareas${
    project.statusDate ? ` · Fecha de estado ${fmt(project.statusDate)}` : ''
  } · Generado ${generated.toLocaleDateString('es-CL')} ${generated.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</div>
</div>
<div class="report-body">${table}${gantt}</div>
<div class="legend">${legend}</div>
</body>
</html>`;
}
