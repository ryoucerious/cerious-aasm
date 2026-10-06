jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PendingConfigs } from './pending-configs';

describe('PendingConfigs', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-pending-'));
    file = path.join(dir, 'pending-configs.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a server whose config the mesh has not stored, across a restart', () => {
    new PendingConfigs(file).add('s1');
    expect(new PendingConfigs(file).ids()).toEqual(['s1']);
  });

  it('lists each server once', () => {
    const pending = new PendingConfigs(file);
    pending.add('s1');
    pending.add('s1');
    expect(pending.ids()).toEqual(['s1']);
  });

  it('forgets a server once its config is stored', () => {
    const pending = new PendingConfigs(file);
    pending.add('s1');
    pending.add('s2');
    pending.remove('s1');
    expect(new PendingConfigs(file).ids()).toEqual(['s2']);
  });

  it('starts empty when the file is unreadable', () => {
    fs.writeFileSync(file, '{not json');
    expect(new PendingConfigs(file).ids()).toEqual([]);
  });
});
