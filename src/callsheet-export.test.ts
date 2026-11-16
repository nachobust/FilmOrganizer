import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { buildCallSheet } from './callsheet';
import { exportCallSheetPDF, exportCallSheetXLSX } from './callsheet-export';
import { newProject, newSheet, type Project } from './model';
import { reducer } from './store';

const saved: { name: string; data: ArrayBuffer }[] = [];
vi.mock('./platform', () => ({
  saveFile: async (name: string, data: ArrayBuffer) => {
    saved.push({ name, data });
    return true;
  },
}));

const DAY = '2026-11-20';

function sheet() {
  const s = newSheet({ sheetNumber: '1', scenes: '1', set: 'BAR', intExt: 'INT', dayNight: 'NIGHT', pages: 8 });
  let p: Project = { ...newProject('Test film'), sheets: [s], schedule: { byDate: { [DAY]: [s.id] } } };
  p = reducer(p, { type: 'addTag', sheetId: s.id, categoryId: 'cast', name: 'Ana' });
  p = reducer(p, { type: 'setCallSheet', date: DAY, patch: { weather: 'Sunny', notes: 'Bring warm clothes' } });
  return buildCallSheet(p, DAY);
}

describe('call sheet exports', () => {
  it('writes a PDF', async () => {
    await exportCallSheetPDF(sheet());
    const f = saved[saved.length - 1];
    expect(f.name).toBe('Test film call sheet day 1 2026-11-20.pdf');
    expect(new TextDecoder().decode(f.data.slice(0, 5))).toBe('%PDF-');
  });

  it('writes an Excel sheet with the day, the scenes and the cast', async () => {
    await exportCallSheetXLSX(sheet());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(saved[saved.length - 1].data);
    const text: string[] = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => text.push(String(c.value ?? ''))));
    expect(text).toEqual(expect.arrayContaining(['Test film', 'CALL SHEET', 'BAR', 'ANA', 'Sunny', 'Bring warm clothes']));
  });
});
