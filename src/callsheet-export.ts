// Call sheet exports: one shooting day as a portrait PDF page and as an Excel sheet.

import type { CallSheet } from './callsheet';
import { saveFile } from './platform';

const fileName = (cs: CallSheet, ext: string) =>
  `${(cs.title.trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-')} call sheet ${cs.dayOff ? 'day off' : `day ${cs.dayNo}`} ${cs.date}.${ext}`;

const or = (v: string) => v || '—';

/** The sections both exports share, as titles and rows of text. */
function tables(cs: CallSheet) {
  return [
    {
      title: 'Locations',
      head: ['Set', 'Address', 'Parking', 'Nearest hospital'],
      body: cs.locations.map((l) => [l.set, l.address, l.parking, l.hospital]),
    },
    {
      title: 'Scenes',
      head: ['Time', 'Sc', 'Set', 'I/E · D/N', 'Synopsis', 'Pages', 'Cast'],
      body: cs.scenes.map((s) => [s.time, s.scene, s.set, s.ieDn, s.synopsis, s.pages, s.cast]),
    },
    {
      title: 'Cast call',
      head: ['ID', 'Character', 'Actor', 'Phone', 'Pickup', 'Call', 'Make-up', 'On set'],
      body: cs.cast.map((c) => [c.id, c.warning ? `${c.character} (!)` : c.character, c.actor, c.phone, c.pickup, c.call, c.makeup, c.onSet]),
    },
    {
      title: 'Crew call',
      head: ['Department', 'Role', 'Name', 'Phone', 'Call'],
      body: cs.crew.map((c) => [c.department, c.role, c.name, c.phone, c.call]),
    },
  ].filter((t) => t.body.length);
}

const keyTimes = (cs: CallSheet): [string, string][] => [
  ['Crew call', or(cs.times.crewCall)],
  ['Shooting', or(cs.times.shooting)],
  ['Lunch', or(cs.times.lunch)],
  ['Wrap', or(cs.times.wrap)],
  ['Sunrise', or(cs.sunrise)],
  ['Sunset', or(cs.sunset)],
];

const dayLine = (cs: CallSheet) => `${cs.dayOff ? 'Day off' : `Day ${cs.dayNo} of ${cs.totalDays}`} · ${cs.dateText}`;

export async function exportCallSheetPDF(cs: CallSheet) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;

  doc.setFont('helvetica', 'bold').setFontSize(18).text(cs.title || 'Untitled', M, 46);
  doc.setFontSize(10).text('CALL SHEET', W - M, 40, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90).text(dayLine(cs), W - M, 54, { align: 'right' });
  doc.setTextColor(0);

  // Key times in one band.
  const times = keyTimes(cs);
  const bandY = 70;
  const cellW = (W - 2 * M) / times.length;
  doc.setFillColor(67, 67, 67).rect(M, bandY, W - 2 * M, 34, 'F');
  times.forEach(([label, value], i) => {
    const x = M + i * cellW + cellW / 2;
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(220).text(label.toUpperCase(), x, bandY + 12, { align: 'center' });
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(255).text(value, x, bandY + 27, { align: 'center' });
  });
  doc.setTextColor(0);

  let y = bandY + 46;
  const lines: string[] = [];
  if (cs.weather) lines.push(`Weather: ${cs.weather}`);
  for (const c of cs.contacts) lines.push(`${c.role}: ${c.name}${c.phone ? ` · ${c.phone}` : ''}`);
  if (lines.length) {
    doc.setFont('helvetica', 'normal').setFontSize(9).text(lines, M, y);
    y += lines.length * 12 + 6;
  }
  if (cs.conflicts.length) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(154, 59, 51);
    const warn = doc.splitTextToSize(cs.conflicts.map((c) => `! ${c}`).join('\n'), W - 2 * M);
    doc.text(warn, M, y);
    y += warn.length * 11 + 6;
    doc.setTextColor(0);
  }

  for (const t of tables(cs)) {
    doc.setFont('helvetica', 'bold').setFontSize(10).text(t.title.toUpperCase(), M, y + 4);
    autoTable(doc, {
      startY: y + 10,
      head: [t.head],
      body: t.body,
      margin: { left: M, right: M },
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [67, 67, 67], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 245, 246] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  }
  if (cs.notes) {
    doc.setFont('helvetica', 'bold').setFontSize(10).text('NOTES', M, y + 4);
    doc.setFont('helvetica', 'normal').setFontSize(9).text(doc.splitTextToSize(cs.notes, W - 2 * M), M, y + 18);
  }
  return saveFile(fileName(cs, 'pdf'), doc.output('arraybuffer'), 'application/pdf');
}

export async function exportCallSheetXLSX(cs: CallSheet) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FilmOrganizer';
  wb.title = `${cs.title} call sheet`;
  const ws = wb.addWorksheet('Call sheet', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.columns = [14, 18, 22, 18, 30, 10, 10, 10].map((width) => ({ width }));
  const COLS = 8;
  const dark = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF434343' } };
  const light = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEFEFEF' } };
  const thin = { style: 'thin' as const, color: { argb: 'FFD4D4D8' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  const title = ws.addRow([cs.title || 'Untitled']);
  ws.mergeCells(title.number, 1, title.number, 5);
  title.getCell(1).font = { bold: true, size: 18 };
  title.getCell(6).value = 'CALL SHEET';
  ws.mergeCells(title.number, 6, title.number, COLS);
  title.getCell(6).font = { bold: true };
  title.getCell(6).alignment = { horizontal: 'right' };
  const sub = ws.addRow([dayLine(cs)]);
  ws.mergeCells(sub.number, 1, sub.number, COLS);
  ws.addRow([]);

  const labels = ws.addRow(keyTimes(cs).map(([l]) => l.toUpperCase()));
  const values = ws.addRow(keyTimes(cs).map(([, v]) => v));
  for (const row of [labels, values])
    row.eachCell((c) => {
      c.fill = dark;
      c.font = { color: { argb: 'FFFFFFFF' }, bold: row === values, size: row === values ? 12 : 8 };
      c.alignment = { horizontal: 'center' };
    });
  ws.addRow([]);
  if (cs.weather) ws.addRow(['Weather', cs.weather]);
  for (const c of cs.contacts) ws.addRow([c.role, c.name, c.phone]);
  for (const c of cs.conflicts) {
    const r = ws.addRow([`! ${c}`]);
    ws.mergeCells(r.number, 1, r.number, COLS);
    r.getCell(1).font = { bold: true, color: { argb: 'FF9A3B33' } };
  }

  for (const t of tables(cs)) {
    ws.addRow([]);
    const h = ws.addRow([t.title.toUpperCase()]);
    h.getCell(1).font = { bold: true };
    const head = ws.addRow(t.head);
    head.eachCell((c) => {
      c.fill = dark;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.border = box;
    });
    t.body.forEach((cells, i) => {
      const r = ws.addRow(cells);
      r.eachCell({ includeEmpty: true }, (c, col) => {
        if (col > t.head.length) return;
        c.border = box;
        c.alignment = { vertical: 'top', wrapText: true };
        if (i % 2) c.fill = light;
      });
    });
  }
  if (cs.notes) {
    ws.addRow([]);
    ws.addRow(['NOTES']).getCell(1).font = { bold: true };
    const n = ws.addRow([cs.notes]);
    ws.mergeCells(n.number, 1, n.number, COLS);
    n.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    n.height = Math.max(20, cs.notes.split('\n').length * 15);
  }
  const buf = await wb.xlsx.writeBuffer();
  return saveFile(fileName(cs, 'xlsx'), buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
