jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DesiredIntents } from './desired-intent';

describe('DesiredIntents', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-intents-'));
    file = path.join(dir, 'desired-intents.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps an unsettled decision across a restart', () => {
    new DesiredIntents(file).set('s1', 'stopped');
    expect(new DesiredIntents(file).get('s1')).toBe('stopped');
  });

  it('forgets a decision once the mesh has stored it', () => {
    const intents = new DesiredIntents(file);
    intents.set('s1', 'stopped');
    intents.settle('s1', 'stopped');
    expect(new DesiredIntents(file).get('s1')).toBeUndefined();
  });

  it('keeps a newer decision when an older one settles', () => {
    const intents = new DesiredIntents(file);
    intents.set('s1', 'stopped');
    intents.set('s1', 'running');
    intents.settle('s1', 'stopped');
    expect(intents.get('s1')).toBe('running');
    expect(intents.entries()).toEqual([['s1', 'running']]);
  });

  it('starts empty when the file is unreadable', () => {
    fs.writeFileSync(file, '{not json');
    expect(new DesiredIntents(file).entries()).toEqual([]);
  });
});
