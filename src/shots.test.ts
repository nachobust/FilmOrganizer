import { describe, expect, it } from 'vitest';
import { newProject, newSheet } from './model';
import { attachShotList, matchShotType, parseShotRows, projectFromShotList, rowsFromText } from './shots';

describe('shot list parsing', () => {
  it('reads Spanish and English shot types', () => {
    expect(matchShotType('PG')).toBe('ws');
    expect(matchShotType('PG corto')).toBe('mws');
    expect(matchShotType('PM ⭐')).toBe('ms');
    expect(matchShotType('PPP')).toBe('ecu');
    expect(matchShotType('Plano secuencia')).toBe('oner');
    expect(matchShotType('MCU')).toBe('mcu');
    expect(matchShotType('Close-up')).toBe('cu');
    expect(matchShotType('PD')).toBe('insert');
    expect(matchShotType('banana')).toBe('');
  });

  it('skips title rows, finds the header and reads each shot', () => {
    const rows = rowsFromText(
      [
        'My shoot — shot list',
        'Nº\tEscena\tTipo de plano\tPersonajes\tDescripción\tMin\tNotas',
        '01.A\t1 - Porche\tPG\tAna, Leo\tThey arrive ⭐\t15\t!! Sunset light',
        '01.B\t1 - Porche\tPP\tAna\tShe looks back\t\t',
        '02.A\t2 - Cocina\tPD\t\tCup on the table\t5\tSteam',
      ].join('\n'),
    );
    const shots = parseShotRows(rows);
    expect(shots).toHaveLength(3);
    expect(shots[0]).toMatchObject({
      number: '01.A',
      scene: '1',
      location: 'Porche',
      type: 'ws',
      talent: ['Ana', 'Leo'],
      minutes: 15,
      keyShot: true,
      alerts: ['!! Sunset light'],
      notes: '',
    });
    expect(shots[1]).toMatchObject({ minutes: null, keyShot: false });
    // A detail with nobody in it is an insert.
    expect(shots[2]).toMatchObject({ category: 'insert', notes: 'Steam' });
  });

  it('reads markdown tables and takes the scene from the shot number', () => {
    const shots = parseShotRows(
      rowsFromText('| Shot | Type | Description |\n|---|---|---|\n| 3.A | WS | Street |\n| 3.B | CU | Face |'),
    );
    expect(shots.map((s) => s.scene)).toEqual(['3', '3']);
  });

  it('returns nothing for prose', () => {
    expect(parseShotRows(rowsFromText('Once upon a time there was a lighthouse.'))).toEqual([]);
  });
});

describe('scenes from shot lists', () => {
  const parsed = parseShotRows(
    rowsFromText(
      [
        'Shot\tScene\tLocation\tType\tTalent\tDescription',
        '1.A\t1\tINT Kitchen\tWS\tAna\tBreakfast',
        '1.B\t1\tINT Kitchen\tCU\tAna\tCoffee',
        '2.A\t2\tEXT Street\tWS\tLeo\tWalks',
      ].join('\n'),
    ),
  );

  it('a new project gets one scene per scene number, with cast confirmed', () => {
    const p = projectFromShotList('Test', parsed);
    expect(p.sheets.map((s) => [s.scenes, s.set, s.intExt])).toEqual([
      ['1', 'KITCHEN', 'INT'],
      ['2', 'STREET', 'EXT'],
    ]);
    expect(p.shots.filter((s) => s.sheetId === p.sheets[0].id)).toHaveLength(2);
    const cast = p.elements.find((e) => e.name === 'ANA')!;
    expect(p.sheets[0].tags.find((t) => t.elementId === cast.id)?.state).toBe('confirmed');
  });

  it('a day shot list matches scenes on the day and adds new ones for the rest', () => {
    const scene1 = newSheet({ sheetNumber: '1', scenes: '1', set: 'KITCHEN' });
    const p = {
      ...newProject('Test'),
      sheets: [scene1],
      schedule: { byDate: { '2026-11-03': [scene1.id] } },
    };
    const { project, matched, created } = attachShotList(p, parsed, '2026-11-03');
    expect(matched).toBe(1);
    expect(created).toBe(1);
    expect(project.schedule.byDate['2026-11-03']).toHaveLength(2);
    expect(project.shots).toHaveLength(3);
    // Uploading again replaces those scenes' shots instead of doubling them.
    expect(attachShotList(project, parsed, '2026-11-03').project.shots).toHaveLength(3);
  });
});
