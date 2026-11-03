import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PDR, newProject } from './model';
import { sequencePdr, type PdrShot } from './pdr';
import { exportPdrIntoTemplate, exportPdrXLSX } from './pdr-export';

const saved: { name: string; data: ArrayBuffer }[] = [];
vi.mock('./platform', () => ({
  saveFile: async (name: string, data: ArrayBuffer) => {
    saved.push({ name, data });
    return true;
  },
}));

const shot = (number: string, o: Partial<PdrShot> = {}): PdrShot => ({
  id: number,
  sheetId: 'x',
  number,
  description: `Shot ${number}`,
  talent: ['Ana'],
  type: 'ws',
  movement: '',
  minutes: 10,
  keyShot: false,
  alerts: [],
  notes: '',
  category: 'principal',
  location: 'Porch',
  setup: '',
  day: 1,
  placeholder: false,
  ...o,
});

async function lastWorkbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(saved[saved.length - 1].data);
  return wb.worksheets[0];
}

const columnText = (ws: ExcelJS.Worksheet, col: number) => {
  const out: string[] = [];
  ws.eachRow((row) => out.push(String(row.getCell(col).value ?? '')));
  return out;
};

describe('Shooting plan Excel export', () => {
  const project = { ...newProject('Test shoot'), pdr: { ...DEFAULT_PDR, sheetLanguage: 'es' as const } };
  const rows = sequencePdr([shot('1.A', { keyShot: true, alerts: ['!! Sunset'] }), shot('1.B', { type: 'cu' })], project.pdr);

  it('writes its own sheet with Spanish labels and shot sizes', async () => {
    await exportPdrXLSX(project, rows, { subtitle: 'Día de rodaje 1', fileTag: ' day 1' });
    expect(saved[saved.length - 1].name).toBe('Test shoot shooting plan day 1.xlsx');
    const ws = await lastWorkbook();
    expect(ws.getCell('A1').value).toBe('Test shoot');
    expect(ws.getCell('A4').value).toBe('HORAS');
    const labels = columnText(ws, 2);
    expect(labels).toContain('CITACIÓN GENERAL');
    expect(labels).toContain('COMIDA');
    expect(columnText(ws, 5)).toEqual(expect.arrayContaining(['PG ⭐', 'PP']));
    let keyRow = 0;
    ws.eachRow((row, r) => row.getCell(2).value === '1.A\nPorch' && (keyRow = r));
    expect(ws.getCell(keyRow, 7).value).toBe('!! Sunset');
    expect(ws.getCell(keyRow, 7).font?.color?.argb).toBe('FFC00000');
  });

  it('fills a template below its header row and keeps what is above', async () => {
    const t = new ExcelJS.Workbook();
    const tws = t.addWorksheet('PDR FINAL');
    tws.getCell('A8').value = 'Old project';
    tws.getCell('A21').value = 'CALLSHEET';
    tws.getCell('A36').value = 'HORAS';
    tws.getCell('C36').value = 'ESCENA';
    tws.getCell('C40').value = 'old sample row';
    tws.mergeCells('A41:A46');
    const file = new File([await t.xlsx.writeBuffer()], 'template.xlsx');

    await exportPdrIntoTemplate(project, rows, { subtitle: '', fileTag: '' }, file);
    const ws = await lastWorkbook();
    expect(ws.getCell('A8').value).toBe('Test shoot');
    expect(ws.getCell('A21').value).toBe('CALLSHEET');
    expect(ws.getCell('C37').value).toBe('CITACIÓN GENERAL');
    expect(columnText(ws, 3)).not.toContain('old sample row');
    expect(columnText(ws, 3)).toContain('1.B\nPorch');
  });
});
