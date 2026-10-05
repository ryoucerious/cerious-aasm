import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IpcService } from './ipc.service';
import type { ElectronApi, ElectronListener } from '../types/electron-api';

describe('IpcService', () => {
  let api: jasmine.SpyObj<ElectronApi>;
  let listeners: Map<string, ElectronListener>;
  let unsubscribe: jasmine.Spy;

  const create = (): IpcService => new IpcService(TestBed.inject(NgZone));

  beforeEach(() => {
    listeners = new Map();
    unsubscribe = jasmine.createSpy('unsubscribe');
    api = jasmine.createSpyObj<ElectronApi>('ElectronApi', ['invoke', 'send', 'on']);
    api.invoke.and.resolveTo('result');
    api.on.and.callFake((channel, listener) => {
      listeners.set(channel, listener);
      return unsubscribe;
    });
    window.electronAPI = api;
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('reports the desktop app only when the preload bridge is present', () => {
    expect(create().isElectron).toBeTrue();
    delete window.electronAPI;
    expect(create().isElectron).toBeFalse();
  });

  it('reports the runtime versions the bridge exposes, and none in the web UI', () => {
    (api as { versions: ElectronApi['versions'] }).versions = { node: '20.18.0', electron: '21.4.4', chrome: '106.0' };
    expect(create().versions).toEqual({ node: '20.18.0', electron: '21.4.4', chrome: '106.0' });
    delete window.electronAPI;
    expect(create().versions).toBeNull();
  });

  it('forwards send and invoke to the bridge', async () => {
    const service = create();
    service.send('window-minimize');
    expect(api.send).toHaveBeenCalledWith('window-minimize');

    await expectAsync(service.invoke('message', { channel: 'x' })).toBeResolvedTo('result');
    expect(api.invoke).toHaveBeenCalledWith('message', { channel: 'x' });
  });

  it('runs listeners inside the Angular zone', () => {
    const service = create();
    let inZone: boolean | undefined;
    service.on('app-close-request', () => inZone = NgZone.isInAngularZone());

    TestBed.inject(NgZone).runOutsideAngular(() => listeners.get('app-close-request')!({}, 'data'));

    expect(inZone).toBeTrue();
  });

  it('passes the event arguments through', () => {
    const service = create();
    const listener = jasmine.createSpy('listener');
    service.on('chan', listener);
    listeners.get('chan')!({}, 'a', 2);
    expect(listener).toHaveBeenCalledWith({}, 'a', 2);
  });

  it('unsubscribes through the returned function or removeListener', () => {
    const service = create();
    const listener = jasmine.createSpy('listener');

    service.on('chan', listener)();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    service.on('chan', listener);
    service.removeListener('chan', listener);
    expect(unsubscribe).toHaveBeenCalledTimes(2);

    service.removeListener('chan', listener);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('leaves a newer registration in place when an older unsubscribe runs', () => {
    const offs: jasmine.Spy[] = [];
    api.on.and.callFake(() => {
      const off = jasmine.createSpy('off');
      offs.push(off);
      return off;
    });
    const service = create();
    const listener = jasmine.createSpy('listener');

    const stale = service.on('chan', listener);
    service.on('chan', listener);
    stale();

    expect(offs[0]).toHaveBeenCalledTimes(1);
    expect(offs[1]).not.toHaveBeenCalled();
  });

  it('does nothing in the web UI, and rejects invoke', async () => {
    delete window.electronAPI;
    const service = create();

    service.send('window-close');
    expect(service.on('chan', () => {})).toEqual(jasmine.any(Function));
    await expectAsync(service.invoke('message')).toBeRejectedWithError('Not running in Electron');
    expect(api.send).not.toHaveBeenCalled();
    expect(api.on).not.toHaveBeenCalled();
  });
});
