import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { BroadcastChannelStrategy } from './index';

const STORAGE_KEY = 'single-tab-manager-broadcast-state';

declare global {
  interface Window {
    sessionStorage?: Storage;
    BroadcastChannel?: typeof BroadcastChannel;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
  }
}

describe('BroadcastChannelStrategy', () => {
  let originalWindow: typeof window;
  let originalLocalStorage: Storage | undefined;

  const localStorageData = new Map<string, string>();
  const sessionStorageData = new Map<string, string>();

  let addEventListenerMock: jest.Mock;
  let removeEventListenerMock: jest.Mock;
  let postMessageMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();

    originalWindow = global.window;
    originalLocalStorage = global.localStorage;

    localStorageData.clear();
    sessionStorageData.clear();

    addEventListenerMock = jest.fn();
    removeEventListenerMock = jest.fn();
    postMessageMock = jest.fn();

    class BroadcastChannelMock {
      name: string;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor(name: string) {
        this.name = name;
      }

      postMessage(message: unknown) {
        postMessageMock(message);
      }

      close() {
        // no-op
      }
    }

    const localStorageMock: Storage = {
      length: 0,
      clear: () => localStorageData.clear(),
      getItem: (key: string) => localStorageData.get(key) ?? null,
      key: (index: number) => Array.from(localStorageData.keys())[index] ?? null,
      removeItem: (key: string) => {
        localStorageData.delete(key);
      },
      setItem: (key: string, value: string) => {
        localStorageData.set(key, value);
      },
    };

    const sessionStorageMock: Storage = {
      length: 0,
      clear: () => sessionStorageData.clear(),
      getItem: (key: string) => sessionStorageData.get(key) ?? null,
      key: (index: number) => Array.from(sessionStorageData.keys())[index] ?? null,
      removeItem: (key: string) => {
        sessionStorageData.delete(key);
      },
      setItem: (key: string, value: string) => {
        sessionStorageData.set(key, value);
      },
    };

    global.window = {
      ...originalWindow,
      sessionStorage: sessionStorageMock,
      localStorage: localStorageMock,
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
      BroadcastChannel: BroadcastChannelMock,
    } as unknown as Window;

    global.localStorage = localStorageMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.window = originalWindow;
    if (originalLocalStorage) {
      global.localStorage = originalLocalStorage;
    }
  });

  describe('constructor', () => {
    it('uses default options when no options provided', () => {
      const strategy = new BroadcastChannelStrategy();
      const heartbeatInterval = strategy['heartbeatInterval'];
      const staleTimeout = strategy['staleTimeout'];
      const channelName = strategy['channelName'];

      expect(heartbeatInterval).toBe(5000);
      expect(staleTimeout).toBe(5000);
      expect(channelName).toBe('single-tab-manager-broadcast');
    });

    it('accepts custom heartbeatInterval option', () => {
      const strategy = new BroadcastChannelStrategy({ heartbeatInterval: 1000 });
      expect(strategy['heartbeatInterval']).toBe(1000);
    });

    it('accepts custom staleTimeout option', () => {
      const strategy = new BroadcastChannelStrategy({ staleTimeout: 3000 });
      expect(strategy['staleTimeout']).toBe(3000);
    });

    it('accepts custom channelName option', () => {
      const strategy = new BroadcastChannelStrategy({ channelName: 'custom-channel' });
      expect(strategy['channelName']).toBe('custom-channel');
    });

    it('accepts onActive callback', () => {
      const onActive = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onActive });
      expect(strategy['onActive']).toBe(onActive);
    });

    it('accepts onBlocked callback', () => {
      const onBlocked = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onBlocked });
      expect(strategy['onBlocked']).toBe(onBlocked);
    });

    it('accepts logLevel option', () => {
      const strategy = new BroadcastChannelStrategy({ logLevel: 'error' });
      expect(() => strategy.start()).not.toThrow();
    });

    it('generates a unique tabId with expected format', () => {
      const strategy = new BroadcastChannelStrategy();
      const tabId = strategy['tabId'];

      expect(tabId).toBeDefined();
      expect(typeof tabId).toBe('string');
      expect(tabId).toMatch(/^\d+-\d+\.\d+$/);
    });

    it('does not throw if sessionStorage access fails', () => {
      const originalSessionStorage = window.sessionStorage;
      window.sessionStorage = {
        getItem: () => { throw new Error('fail'); },
        setItem: () => { throw new Error('fail'); },
        removeItem: () => { throw new Error('fail'); },
        clear: () => { throw new Error('fail'); },
        key: () => null,
        length: 0,
      } as unknown as Storage;

      expect(() => new BroadcastChannelStrategy()).not.toThrow();

      window.sessionStorage = originalSessionStorage;
    });
  });

  describe('start', () => {
    it('is idempotent - does not reinitialize on subsequent calls', () => {
      const strategy = new BroadcastChannelStrategy();

      const initChannelSpy = jest.spyOn(strategy as any, 'initChannel');
      const initBeforeUnloadSpy = jest.spyOn(strategy as any, 'initBeforeUnload');
      const startCheckTimerSpy = jest.spyOn(strategy as any, 'startCheckTimer');

      strategy.start();
      strategy.start();

      expect(initChannelSpy).toHaveBeenCalledTimes(1);
      expect(initBeforeUnloadSpy).toHaveBeenCalledTimes(1);
      expect(startCheckTimerSpy).toHaveBeenCalledTimes(1);
    });

    it('sets isStarted to true after starting', () => {
      const strategy = new BroadcastChannelStrategy();
      expect(strategy['isStarted']).toBe(false);

      strategy.start();

      expect(strategy['isStarted']).toBe(true);
    });

    it('with no existing state calls becomeActive and startHeartbeat', () => {
      const onActive = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onActive });

      const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');
      const startHeartbeatSpy = jest.spyOn(strategy as any, 'startHeartbeat');

      strategy.start();

      expect(becomeActiveSpy).toHaveBeenCalled();
      expect(startHeartbeatSpy).toHaveBeenCalled();
      expect(onActive).toHaveBeenCalled();
    });

    it('when storage owner is this tab becomes active again', () => {
      const strategy = new BroadcastChannelStrategy();
      const tabId = strategy['tabId'];

      localStorageData.set(
        STORAGE_KEY,
        JSON.stringify({
          ownerId: tabId,
          lastSeen: Date.now(),
        }),
      );

      const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');

      strategy.start();

      expect(becomeActiveSpy).toHaveBeenCalled();
    });

    it('when another tab is active calls onBlocked', () => {
      const onBlocked = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onBlocked });

      jest.spyOn(strategy as any, 'readState').mockReturnValue({
        ownerId: 'other-tab',
        lastSeen: Date.now(),
      });
      jest.spyOn(strategy as any, 'isReloadScenario').mockReturnValue(false);
      jest.spyOn(strategy as any, 'isStateStale').mockReturnValue(false);

      strategy.start();

      expect(onBlocked).toHaveBeenCalled();
    });

    it('in reload scenario with stale state becomes active', () => {
      const onActive = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onActive });

      jest.spyOn(strategy as any, 'readState').mockReturnValue({
        ownerId: 'other-tab',
        lastSeen: Date.now() - 10000,
      });
      jest.spyOn(strategy as any, 'isReloadScenario').mockReturnValue(true);
      jest.spyOn(strategy as any, 'isStateStale').mockReturnValue(true);

      const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');

      strategy.start();

      expect(becomeActiveSpy).toHaveBeenCalled();
      expect(onActive).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('is no-op when not started', () => {
      const strategy = new BroadcastChannelStrategy();

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat');
      const disposeChannelSpy = jest.spyOn(strategy as any, 'disposeChannel');

      strategy.stop();

      expect(stopHeartbeatSpy).not.toHaveBeenCalled();
      expect(disposeChannelSpy).not.toHaveBeenCalled();
    });

    it('clears isStarted after stopping', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['isStarted'] = true;

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
      const stopCheckTimerSpy = jest.spyOn(strategy as any, 'stopCheckTimer').mockImplementation(() => {});
      const disposeChannelSpy = jest.spyOn(strategy as any, 'disposeChannel').mockImplementation(() => {});
      const disposeBeforeUnloadSpy = jest.spyOn(strategy as any, 'disposeBeforeUnload').mockImplementation(() => {});

      strategy.stop();

      expect(strategy['isStarted']).toBe(false);
      stopHeartbeatSpy.mockRestore();
      stopCheckTimerSpy.mockRestore();
      disposeChannelSpy.mockRestore();
      disposeBeforeUnloadSpy.mockRestore();
    });

    it('clears timers, channel and storage when active', () => {
      const strategy = new BroadcastChannelStrategy();

      strategy['isStarted'] = true;
      strategy['active'] = true;

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
      const stopCheckTimerSpy = jest.spyOn(strategy as any, 'stopCheckTimer').mockImplementation(() => {});
      const disposeChannelSpy = jest.spyOn(strategy as any, 'disposeChannel').mockImplementation(() => {});
      const disposeBeforeUnloadSpy = jest.spyOn(strategy as any, 'disposeBeforeUnload').mockImplementation(() => {});
      jest.spyOn(strategy as any, 'isActive').mockReturnValue(true);
      const clearStateSpy = jest.spyOn(strategy as any, 'clearState').mockImplementation(() => {});

      strategy.stop();

      expect(stopHeartbeatSpy).toHaveBeenCalled();
      expect(stopCheckTimerSpy).toHaveBeenCalled();
      expect(disposeChannelSpy).toHaveBeenCalled();
      expect(disposeBeforeUnloadSpy).toHaveBeenCalled();
      expect(clearStateSpy).toHaveBeenCalled();
    });

    it('does not clear state when not active', () => {
      const strategy = new BroadcastChannelStrategy();

      strategy['isStarted'] = true;
      strategy['active'] = false;

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
      const stopCheckTimerSpy = jest.spyOn(strategy as any, 'stopCheckTimer').mockImplementation(() => {});
      const disposeChannelSpy = jest.spyOn(strategy as any, 'disposeChannel').mockImplementation(() => {});
      const disposeBeforeUnloadSpy = jest.spyOn(strategy as any, 'disposeBeforeUnload').mockImplementation(() => {});
      jest.spyOn(strategy as any, 'isActive').mockReturnValue(false);
      const clearStateSpy = jest.spyOn(strategy as any, 'clearState').mockImplementation(() => {});

      strategy.stop();

      expect(clearStateSpy).not.toHaveBeenCalled();
      stopHeartbeatSpy.mockRestore();
      stopCheckTimerSpy.mockRestore();
      disposeChannelSpy.mockRestore();
      disposeBeforeUnloadSpy.mockRestore();
    });
  });

  describe('isActive', () => {
    it('returns false when storage has no state', () => {
      const strategy = new BroadcastChannelStrategy();
      jest.spyOn(strategy as any, 'readState').mockReturnValue(null);

      expect(strategy.isActive()).toBe(false);
    });

    it('returns false when storage owner is different tab', () => {
      const strategy = new BroadcastChannelStrategy();
      jest.spyOn(strategy as any, 'readState').mockReturnValue({
        ownerId: 'other-tab',
        lastSeen: Date.now(),
      });

      expect(strategy.isActive()).toBe(false);
    });

    it('returns true when storage owner is this tab', () => {
      const strategy = new BroadcastChannelStrategy();
      const tabId = strategy['tabId'];

      jest.spyOn(strategy as any, 'readState').mockReturnValue({
        ownerId: tabId,
        lastSeen: Date.now(),
      });

      expect(strategy.isActive()).toBe(true);
    });
  });

  describe('takeover', () => {
    it('calls becomeActive and startHeartbeat', () => {
      const strategy = new BroadcastChannelStrategy();

      const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');
      const startHeartbeatSpy = jest.spyOn(strategy as any, 'startHeartbeat');

      strategy.takeover();

      expect(becomeActiveSpy).toHaveBeenCalledTimes(1);
      expect(startHeartbeatSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('initChannel', () => {
    it('sets channel to null when window is undefined', () => {
      const strategy = new BroadcastChannelStrategy();

      const originalWindow = global.window;
      // @ts-expect-error test env
      global.window = undefined;

      strategy['initChannel']();
      expect(strategy['channel']).toBeNull();

      global.window = originalWindow;
    });

    it('sets channel to null when BroadcastChannel is not available', () => {
      const strategy = new BroadcastChannelStrategy();
      // @ts-expect-error test env
      delete window.BroadcastChannel;

      strategy['initChannel']();

      expect(strategy['channel']).toBeNull();
    });

    it('verifies initChannel behavior', () => {
      const strategy = new BroadcastChannelStrategy({ channelName: 'test-channel' });

      // Test that the method doesn't throw
      expect(() => strategy['initChannel']()).not.toThrow();
    });
  });

  describe('disposeChannel', () => {
    it('sets channel to null', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['initChannel']();

      strategy['disposeChannel']();

      expect(strategy['channel']).toBeNull();
    });

    it('is safe to call when channel is null', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['channel'] = null;

      expect(() => strategy['disposeChannel']()).not.toThrow();
    });
  });

  describe('broadcastStateChanged', () => {
    it('does nothing when channel is null', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['channel'] = null;

      strategy['broadcastStateChanged']();

      expect(postMessageMock).not.toHaveBeenCalled();
    });

    it('is safe to call when channel exists', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['initChannel']();

      expect(() => strategy['broadcastStateChanged']()).not.toThrow();
    });
  });

  describe('initBeforeUnload', () => {
    it('stores beforeUnloadHandler', () => {
      const strategy = new BroadcastChannelStrategy();

      strategy['initBeforeUnload']();

      expect(strategy['beforeUnloadHandler']).not.toBeNull();
    });

    it('is safe when window is undefined', () => {
      const strategy = new BroadcastChannelStrategy();

      // @ts-expect-error test env
      global.window = undefined;

      expect(() => strategy['initBeforeUnload']()).not.toThrow();
    });
  });

  describe('disposeBeforeUnload', () => {
    it('sets handler to null', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['initBeforeUnload']();

      strategy['disposeBeforeUnload']();

      expect(strategy['beforeUnloadHandler']).toBeNull();
    });

    it('is safe when window is undefined', () => {
      const strategy = new BroadcastChannelStrategy();

      // @ts-expect-error test env
      global.window = undefined;

      expect(() => strategy['disposeBeforeUnload']()).not.toThrow();
    });
  });

  describe('startHeartbeat', () => {
    it('creates interval timer', () => {
      const strategy = new BroadcastChannelStrategy({ heartbeatInterval: 100 });

      strategy['startHeartbeat']();

      expect(strategy['heartbeatTimer']).not.toBeNull();
    });

    it('is safe to call multiple times', () => {
      const strategy = new BroadcastChannelStrategy({ heartbeatInterval: 100 });

      expect(() => strategy['startHeartbeat']()).not.toThrow();
      expect(() => strategy['startHeartbeat']()).not.toThrow();
    });
  });

  describe('stopHeartbeat', () => {
    it('clears the timer', () => {
      const strategy = new BroadcastChannelStrategy({ heartbeatInterval: 100 });
      strategy['startHeartbeat']();

      strategy['stopHeartbeat']();

      expect(strategy['heartbeatTimer']).toBeNull();
    });

    it('is safe to call when timer is null', () => {
      const strategy = new BroadcastChannelStrategy();

      expect(() => strategy['stopHeartbeat']()).not.toThrow();
    });
  });

  describe('startCheckTimer', () => {
    it('creates check timer', () => {
      const strategy = new BroadcastChannelStrategy();

      strategy['startCheckTimer']();

      expect(strategy['checkTimer']).not.toBeNull();
    });
  });

  describe('stopCheckTimer', () => {
    it('clears the timer', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['startCheckTimer']();

      strategy['stopCheckTimer']();

      expect(strategy['checkTimer']).toBeNull();
    });

    it('is safe to call when timer is null', () => {
      const strategy = new BroadcastChannelStrategy();

      expect(() => strategy['stopCheckTimer']()).not.toThrow();
    });
  });

  describe('handleExternalStateChange', () => {
    it('becomes active when no state exists and not currently active', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['active'] = false;

      jest.spyOn(strategy as any, 'readState').mockReturnValue(null);
      const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');

      strategy['handleExternalStateChange']();

      expect(becomeActiveSpy).toHaveBeenCalled();
    });

    it('becomes active when this tab owns state', () => {
      const strategy = new BroadcastChannelStrategy();
      const tabId = strategy['tabId'];
      strategy['active'] = false;

      jest.spyOn(strategy as any, 'readState').mockReturnValue({
        ownerId: tabId,
        lastSeen: Date.now(),
      });
      const becomeActiveSpy = jest.spyOn(strategy as any, 'becomeActive');

      strategy['handleExternalStateChange']();

      expect(becomeActiveSpy).toHaveBeenCalled();
    });

    it('becomes blocked when another tab owns state and state is not stale', () => {
      const strategy = new BroadcastChannelStrategy();
      strategy['active'] = true;

      jest.spyOn(strategy as any, 'readState').mockReturnValue({
        ownerId: 'other-tab',
        lastSeen: Date.now(),
      });
      jest.spyOn(strategy as any, 'isStateStale').mockReturnValue(false);
      const becomeBlockedSpy = jest.spyOn(strategy as any, 'becomeBlocked');

      strategy['handleExternalStateChange']();

      expect(becomeBlockedSpy).toHaveBeenCalled();
    });
  });

  describe('becomeActive', () => {
    it('sets active to true and calls onActive callback', () => {
      const onActive = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onActive });

      strategy['active'] = false;
      strategy['becomeActive']();

      expect(strategy['active']).toBe(true);
      expect(onActive).toHaveBeenCalled();
    });

    it('writes state when becoming active', () => {
      const strategy = new BroadcastChannelStrategy();

      strategy['active'] = false;
      const writeStateSpy = jest.spyOn(strategy as any, 'writeState');

      strategy['becomeActive']();

      expect(writeStateSpy).toHaveBeenCalled();
    });

    it('does not call onActive again if already active', () => {
      const onActive = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onActive });

      strategy['active'] = true;

      strategy['becomeActive']();

      expect(onActive).not.toHaveBeenCalled();
    });
  });

  describe('becomeBlocked', () => {
    it('sets active to false and calls onBlocked callback', () => {
      const onBlocked = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onBlocked });

      strategy['active'] = true;
      strategy['becomeBlocked']();

      expect(strategy['active']).toBe(false);
      expect(onBlocked).toHaveBeenCalled();
    });

    it('does not call onBlocked if already blocked', () => {
      const onBlocked = jest.fn();
      const strategy = new BroadcastChannelStrategy({ onBlocked });

      strategy['active'] = false;

      strategy['becomeBlocked']();

      expect(onBlocked).not.toHaveBeenCalled();
    });
  });

describe('isStateStale', () => {
    it('returns true when lastSeen is older than staleTimeout', () => {
      const strategy = new BroadcastChannelStrategy({ staleTimeout: 1000 });

      const state = {
        ownerId: 'test',
        lastSeen: Date.now() - 2000,
      };

      expect(strategy['isStateStale'](state)).toBe(true);
    });

    it('returns false when lastSeen is within staleTimeout', () => {
      const strategy = new BroadcastChannelStrategy({ staleTimeout: 1000 });

      const state = {
        ownerId: 'test',
        lastSeen: Date.now() - 500,
      };

      expect(strategy['isStateStale'](state)).toBe(false);
    });
  });

  describe('isReloadScenario', () => {
    it('returns isReload flag', () => {
      const strategy = new BroadcastChannelStrategy();

      expect(strategy['isReloadScenario']()).toBeDefined();
    });
  });
});