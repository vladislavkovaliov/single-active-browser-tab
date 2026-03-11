import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { BroadcastChannelStrategy } from './index';

const STORAGE_KEY = 'single-tab-manager-broadcast-state';

declare global {
  interface Window {
    sessionStorage?: Storage;
    BroadcastChannel?: typeof BroadcastChannel;
  }
}

describe('BroadcastChannelStrategy', () => {
  let originalWindow: typeof window;
  let originalLocalStorage: Storage | undefined;

  const storageData = new Map<string, string>();

  let addEventListenerMock: jest.Mock;
  let removeEventListenerMock: jest.Mock;
  let postMessageMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();

    // Save originals
    // @ts-expect-error test env
    originalWindow = global.window;
    originalLocalStorage = global.localStorage;

    storageData.clear();

    const localStorageMock: Storage = {
      length: 0,
      clear: () => storageData.clear(),
      getItem: (key: string) => storageData.get(key) ?? null,
      key: (index: number) => Array.from(storageData.keys())[index] ?? null,
      removeItem: (key: string) => {
        storageData.delete(key);
      },
      setItem: (key: string, value: string) => {
        storageData.set(key, value);
      },
    };

    const sessionStorageMock: Storage = {
      length: 0,
      clear: () => {},
      getItem: (key: string) => storageData.get(key) ?? null,
      key: (index: number) => Array.from(storageData.keys())[index] ?? null,
      removeItem: (key: string) => {
        storageData.delete(key);
      },
      setItem: (key: string, value: string) => {
        storageData.set(key, value);
      },
    };

    addEventListenerMock = jest.fn();
    removeEventListenerMock = jest.fn();
    postMessageMock = jest.fn();

    class BroadcastChannelMock {
      name: string;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor(name: string) {
        this.name = name;
      }

      postMessage(message: any) {
        postMessageMock(message);
      }

      close() {
        // no-op
      }
    }

    // @ts-expect-error test env
    global.window = {
      ...(global.window || {}),
      sessionStorage: sessionStorageMock,
      localStorage: localStorageMock,
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
      BroadcastChannel: BroadcastChannelMock,
    } as unknown as Window;

    // Ensure global and window both reference the same localStorage mock
    // @ts-expect-error test env
    global.localStorage = localStorageMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    // Restore globals
    // @ts-expect-error test env
    global.window = originalWindow;
    if (originalLocalStorage) {
      // @ts-expect-error test env
      global.localStorage = originalLocalStorage;
      // @ts-expect-error test env
      global.window.localStorage = originalLocalStorage;
    }
  });

  it('uses defaults when no options provided and logs init', () => {
    const strategy = new BroadcastChannelStrategy();

    // @ts-expect-error access for test
    const heartbeatInterval = strategy['heartbeatInterval'];
    // @ts-expect-error access for test
    const staleTimeout = strategy['staleTimeout'];
    // @ts-expect-error access for test
    const channelName = strategy['channelName'];

    expect(heartbeatInterval).toBe(5000);
    expect(staleTimeout).toBe(5000);
    expect(channelName).toBe('single-tab-manager-broadcast');
  });

  it('reuses existing tabId from sessionStorage on subsequent instances and marks reload', () => {
    const first = new BroadcastChannelStrategy();
    // @ts-expect-error access for test
    const firstId = first['tabId'];
    // @ts-expect-error access for test
    const firstIsReload = first['isReload'];

    const second = new BroadcastChannelStrategy();
    // @ts-expect-error access for test
    const secondId = second['tabId'];
    // @ts-expect-error access for test
    const secondIsReload = second['isReload'];

    expect(firstId).toBeDefined();
    expect(secondId).toBe(firstId);
    expect(secondIsReload).toBe(true);
  });

  it('constructor does not throw if sessionStorage access fails', () => {
    const originalSessionStorage = window.sessionStorage;

    // @ts-expect-error test env
    window.sessionStorage = {
      getItem: () => {
        throw new Error('fail');
      },
      setItem: () => {
        throw new Error('fail');
      },
      removeItem: () => {
        throw new Error('fail');
      },
      clear: () => {
        throw new Error('fail');
      },
      key: () => null,
      length: 0,
    } as Storage;

    expect(() => new BroadcastChannelStrategy()).not.toThrow();

    // Restore
    // @ts-expect-error test env
    window.sessionStorage = originalSessionStorage;
  });

  it('start is idempotent', () => {
    const strategy = new BroadcastChannelStrategy();

    // @ts-expect-error access for test
    const initChannelSpy = jest.spyOn(strategy as any, 'initChannel');
    // @ts-expect-error access for test
    const initBeforeUnloadSpy = jest.spyOn(strategy as any, 'initBeforeUnload');
    // @ts-expect-error access for test
    const startCheckTimerSpy = jest.spyOn(strategy as any, 'startCheckTimer');

    strategy.start();
    strategy.start();

    expect(initChannelSpy).toHaveBeenCalledTimes(1);
    expect(initBeforeUnloadSpy).toHaveBeenCalledTimes(1);
    expect(startCheckTimerSpy).toHaveBeenCalledTimes(1);
  });

  it('start with no existing state becomes active and starts heartbeat', () => {
    const onActive = jest.fn();
    const strategy = new BroadcastChannelStrategy({ onActive });

    // Ensure there is no state in localStorage
    storageData.delete(STORAGE_KEY);

    // @ts-expect-error access for test
    const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');
    // @ts-expect-error access for test
    const startHeartbeatSpy = jest.spyOn(strategy as any, 'startHeartbeat');

    strategy.start();

    expect(becomeActiveSpy).toHaveBeenCalledTimes(1);
    expect(startHeartbeatSpy).toHaveBeenCalledTimes(1);
    expect(onActive).toHaveBeenCalledTimes(1);
  });

  it('start when storage owner is this tab becomes active again', () => {
    const strategy = new BroadcastChannelStrategy();
    // @ts-expect-error access for test
    const tabId = strategy['tabId'] as string;

    storageData.set(
      STORAGE_KEY,
      JSON.stringify({
        ownerId: tabId,
        lastSeen: Date.now(),
      }),
    );

    // @ts-expect-error access for test
    const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');

    strategy.start();

    expect(becomeActiveSpy).toHaveBeenCalled();
  });

  it('start when another tab is active calls onBlocked', () => {
    const onBlocked = jest.fn();
    const strategy = new BroadcastChannelStrategy({ onBlocked });

    // Force readState / isReloadScenario / isStateStale behavior for this test
    // @ts-expect-error access for test
    jest.spyOn(strategy as any, 'readState').mockReturnValue({
      ownerId: 'other-tab',
      lastSeen: Date.now(),
    });
    // @ts-expect-error access for test
    jest.spyOn(strategy as any, 'isReloadScenario').mockReturnValue(false);
    // @ts-expect-error access for test
    jest.spyOn(strategy as any, 'isStateStale').mockReturnValue(false);

    strategy.start();

    expect(onBlocked).toHaveBeenCalled();
  });

  it('stop is a no-op when not started', () => {
    const strategy = new BroadcastChannelStrategy();

    // @ts-expect-error access for test
    const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat');
    // @ts-expect-error access for test
    const disposeChannelSpy = jest.spyOn(strategy as any, 'disposeChannel');

    strategy.stop();

    expect(stopHeartbeatSpy).not.toHaveBeenCalled();
    expect(disposeChannelSpy).not.toHaveBeenCalled();
  });

  it('stop clears timers, channel and storage when active', () => {
    const strategy = new BroadcastChannelStrategy();

    // Simulate started and active state
    // @ts-expect-error access for test
    strategy['isStarted'] = true;
    // @ts-expect-error access for test
    strategy['active'] = true;

    // @ts-expect-error access for test
    const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
    // @ts-expect-error access for test
    const stopCheckTimerSpy = jest
      .spyOn(strategy as any, 'stopCheckTimer')
      .mockImplementation(() => {});
    // @ts-expect-error access for test
    const disposeChannelSpy = jest.spyOn(strategy as any, 'disposeChannel').mockImplementation(() => {});
    // @ts-expect-error access for test
    const disposeBeforeUnloadSpy = jest
      .spyOn(strategy as any, 'disposeBeforeUnload')
      .mockImplementation(() => {});
    // Ensure clearState is invoked when stop runs
    // @ts-expect-error access for test
    jest.spyOn(strategy as any, 'isActive').mockReturnValue(true);
    // @ts-expect-error access for test
    const clearStateSpy = jest.spyOn(strategy as any, 'clearState').mockImplementation(() => {});

    strategy.stop();

    expect(stopHeartbeatSpy).toHaveBeenCalled();
    expect(stopCheckTimerSpy).toHaveBeenCalled();
    expect(disposeChannelSpy).toHaveBeenCalled();
    expect(disposeBeforeUnloadSpy).toHaveBeenCalled();
    expect(clearStateSpy).toHaveBeenCalled();
  });

  it('isActive returns true only when storage owner matches tabId', () => {
    const strategy = new BroadcastChannelStrategy();

    // @ts-expect-error access for test
    const tabId = strategy['tabId'] as string;

    // Mock readState for different scenarios
    // @ts-expect-error access for test
    const readStateSpy = jest.spyOn(strategy as any, 'readState');

    readStateSpy.mockReturnValueOnce(null);
    expect(strategy.isActive()).toBe(false);

    readStateSpy.mockReturnValueOnce({
      ownerId: 'other',
      lastSeen: Date.now(),
    });
    expect(strategy.isActive()).toBe(false);

    readStateSpy.mockReturnValueOnce({
      ownerId: tabId,
      lastSeen: Date.now(),
    });
    expect(strategy.isActive()).toBe(true);
  });

  it('takeover forces active and starts heartbeat', () => {
    const strategy = new BroadcastChannelStrategy();

    // @ts-expect-error access for test
    const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');
    // @ts-expect-error access for test
    const startHeartbeatSpy = jest.spyOn(strategy as any, 'startHeartbeat');

    strategy.takeover();

    expect(becomeActiveSpy).toHaveBeenCalledTimes(1);
    expect(startHeartbeatSpy).toHaveBeenCalledTimes(1);
  });

  it('initChannel sets channel to null when BroadcastChannel is not available', () => {
    // Remove BroadcastChannel from window
    // @ts-expect-error test env
    delete window.BroadcastChannel;

    const strategy = new BroadcastChannelStrategy();
    // @ts-expect-error access for test
    strategy['initChannel']();

    // @ts-expect-error access for test
    expect(strategy['channel']).toBeNull();
  });

  it('broadcastStateChanged posts message when channel exists', () => {
    const strategy = new BroadcastChannelStrategy();
    const post = jest.fn();

    // Inject a fake channel directly
    // @ts-expect-error access for test
    strategy['channel'] = {
      postMessage: post,
      close: () => {},
    } as any;

    // @ts-expect-error access for test
    strategy['broadcastStateChanged']();

    expect(post).toHaveBeenCalledWith({ type: 'state-changed' });
  });
});

