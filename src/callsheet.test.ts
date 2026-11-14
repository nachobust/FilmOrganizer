import { describe, expect, it } from 'vitest';
import { buildCallSheet, planStarted, scheduleConflicts } from './callsheet';
import { newProject, newSheet, type Project } from './model';
import { reducer } from './store';

const DAY = '2026-11-20';

/** Two scenes on one day; ANA in both, LEO in the second. */
function project(): Project {
  const s1 = newSheet({ sheetNumber: '1', scenes: '1', set: 'BAR', intExt: 'INT', dayNight: 'NIGHT', pages: 8 });
  const s2 = newSheet({ sheetNumber: '2', scenes: '2', set: 'STREET', intExt: 'EXT', dayNight: 'NIGHT', pages: 4 });
  let p: Project = { ...newProject('Test'), sheets: [s1, s2], schedule: { byDate: { [DAY]: [s1.id, s2.id] } } };
  p = reducer(p, { type: 'addTag', sheetId: s1.id, categoryId: 'cast', name: 'Ana' });
  p = reducer(p, { type: 'addTag', sheetId: s2.id, categoryId: 'cast', name: 'Ana' });
  p = reducer(p, { type: 'addTag', sheetId: s2.id, categoryId: 'cast', name: 'Leo' });
  return p;
}
const el = (p: Project, name: string) => p.elements.find((e) => e.name === name)!;

describe('call sheet', () => {
  it('lists the day’s scenes, each character once, and the set details', () => {
    let p = project();
    p = reducer(p, { type: 'updateElement', elementId: el(p, 'ANA').id, patch: { actor: 'Ana Ruiz' } });
    p = reducer(p, { type: 'setLocation', set: 'Bar', patch: { address: 'Calle Mayor 1' } });
    const cs = buildCallSheet(p, DAY);
    expect(cs.scenes.map((s) => [s.scene, s.set, s.ieDn])).toEqual([
      ['1', 'BAR', 'INT · NIGHT'],
      ['2', 'STREET', 'EXT · NIGHT'],
    ]);
    expect(cs.cast.map((c) => [c.character, c.actor, c.call])).toEqual([
      ['ANA', 'Ana Ruiz', '08:00'],
      ['LEO', '', '08:00'],
    ]);
    expect(cs.locations[0]).toMatchObject({ set: 'BAR', address: 'Calle Mayor 1' });
    // No shooting plan started yet, so no times from it.
    expect(cs.times.shooting).toBe('');
  });

  it('takes times from the shooting plan once it is started', () => {
    let p = project();
    expect(planStarted(p, DAY)).toBe(false);
    p = reducer(p, { type: 'startPdr', date: DAY });
    const cs = buildCallSheet(p, DAY);
    expect(cs.times.shooting).toBe('10:00');
    expect(cs.scenes[0].time).toBe('10:00');
    expect(cs.cast.find((c) => c.character === 'ANA')?.onSet).toBe('10:00');
  });

  it('flags actors who can’t shoot that day, and scenes on a day off', () => {
    let p = project();
    p = reducer(p, { type: 'updateElement', elementId: el(p, 'LEO').id, patch: { unavailable: [DAY] } });
    p = reducer(p, { type: 'toggleDayOff', date: DAY });
    const texts = scheduleConflicts(p).map((c) => c.text);
    expect(texts.filter((t) => t.includes('day off'))).toHaveLength(2);
    expect(texts.filter((t) => t.includes('LEO'))).toHaveLength(1);
    expect(buildCallSheet(p, DAY).cast.find((c) => c.character === 'LEO')?.warning).toBe('Not available on this date');
  });
});
