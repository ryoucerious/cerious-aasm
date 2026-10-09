import { BusyService } from './busy.service';

describe('BusyService', () => {
  let busy: BusyService;
  let shown: (string | null)[];

  beforeEach(() => {
    busy = new BusyService();
    shown = [];
    busy.message$.subscribe(message => shown.push(message));
  });

  it('has nothing to show while nothing is under way', () => {
    expect(busy.message).toBeNull();
    expect(shown).toEqual([null]);
  });

  it('shows what is under way until it is done', () => {
    const done = busy.start('Removing Docker 1…');
    expect(busy.message).toBe('Removing Docker 1…');

    done();

    expect(busy.message).toBeNull();
    expect(shown).toEqual([null, 'Removing Docker 1…', null]);
  });

  // Two pages can each start something; one finishing must not take the other's spinner away.
  it('keeps showing what is still under way when something else finishes', () => {
    const first = busy.start('Leaving the mesh…');
    const second = busy.start('Updating ARK…');
    expect(busy.message).toBe('Updating ARK…');

    second();
    expect(busy.message).toBe('Leaving the mesh…');

    first();
    expect(busy.message).toBeNull();
  });

  it('ignores being told twice that something is done', () => {
    const first = busy.start('Leaving the mesh…');
    const second = busy.start('Leaving the mesh…');

    second();
    second();

    expect(busy.message).toBe('Leaving the mesh…');
    first();
    expect(busy.message).toBeNull();
  });
});
