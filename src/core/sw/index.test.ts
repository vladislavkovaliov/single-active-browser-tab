import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceWorkerStrategy } from './index';
import { DEFAULT_HEARTBEAT_INTERVAL, DEFAULT_SW_PATH, EVENTS } from './constants';

declare global {
  // eslint-disable-next-line no-var
  var navigator: Navigator & { serviceWorker?: ServiceWorkerContainer };
  // eslint-disable-next-line no-var
  var window: Window & { sessionStorage?: Storage; navigator?: Navigator };
}

describe('ServiceWorkerStrategy', () => {
  let originalNavigator: Navigator;
  let originalWindow: typeof globalThis.window;
  let storageData: Map<string, string>;
  let controllerMock: { postMessage: jest.Mock };
  let serviceWorkerContainer: Partial<ServiceWorkerContainer>;
  let sessionStorage: Storage;
  let mockWindow: { sessionStorage: Storage; navigator: Navigator };
  let navigatorMock: Navigator & { serviceWorker?: ServiceWorkerContainer };

  beforeEach(() => {
    jest.useFakeTimers();

    originalNavigator = global.navigator;
    originalWindow = globalThis.window;

    storageData = new Map<string, string>();
    sessionStorage = {
      length: 0,
      clear: () => storageData.clear(),
      getItem: (key: string) => storageData.get(key) ?? null,
      key: (index: number) => Array.from(storageData.keys())[index] ?? null,
      removeItem: (key: string) => storageData.delete(key),
      setItem: (key: string, value: string) => storageData.set(key, value),
    };

    controllerMock = { postMessage: jest.fn() };

    const registration: Partial<ServiceWorkerRegistration> = {
      scope: '/',
      update: jest.fn(),
      addEventListener: jest.fn(),
      waiting: undefined,
    };

    serviceWorkerContainer = {
      controller: controllerMock as unknown as ServiceWorker,
      register: jest.fn().mockResolvedValue(registration as ServiceWorkerRegistration),
      ready: Promise.resolve(registration as ServiceWorkerRegistration),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    const swContainer = serviceWorkerContainer as ServiceWorkerContainer;
    navigatorMock = {
      serviceWorker: swContainer,
    } as unknown as Navigator;

    mockWindow = {
      sessionStorage,
      navigator: navigatorMock,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = mockWindow;
    
    // Use Object.defineProperty to ensure the property is properly defined
    Object.defineProperty(global, 'navigator', {
      value: navigatorMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = originalWindow;
  });

  describe('validateSwPath', () => {
    it('normalizes path by removing leading dots and slashes', () => {
      const path = ServiceWorkerStrategy.validateSwPath('./sw.js');
      expect(path).toBe('/sw.js');
    });

    it('normalizes multiple leading slashes', () => {
      const path = ServiceWorkerStrategy.validateSwPath('///sw.js');
      expect(path).toBe('/sw.js');
    });

    it('rejects path traversal attempts', () => {
      expect(() => ServiceWorkerStrategy.validateSwPath('/foo/../etc/passwd')).toThrow(
        'Invalid swPath: path traversal not allowed'
      );
    });

    it('rejects path traversal in the middle of path', () => {
      expect(() => ServiceWorkerStrategy.validateSwPath('/foo/../bar/sw.js')).toThrow(
        'Invalid swPath: path traversal not allowed'
      );
    });
  });

  describe('constructor', () => {
    it('uses default options when none provided', () => {
      const strategy = new ServiceWorkerStrategy();
      const options = strategy['options'];

      expect(options.swPath).toBe(DEFAULT_SW_PATH);
      expect(options.heartbeatInterval).toBe(DEFAULT_HEARTBEAT_INTERVAL);
    });

    it('accepts custom swPath option', () => {
      const strategy = new ServiceWorkerStrategy({ swPath: '/custom/sw.js' });
      const options = strategy['options'];

      expect(options.swPath).toBe('/custom/sw.js');
    });

    it('accepts custom heartbeatInterval option', () => {
      const strategy = new ServiceWorkerStrategy({ heartbeatInterval: 5000 });
      const options = strategy['options'];

      expect(options.heartbeatInterval).toBe(5000);
    });

    it('accepts onActive callback option', () => {
      const onActive = jest.fn();
      const strategy = new ServiceWorkerStrategy({ onActive });
      const options = strategy['options'];

      expect(options.onActive).toBe(onActive);
    });

    it('accepts onBlocked callback option', () => {
      const onBlocked = jest.fn();
      const strategy = new ServiceWorkerStrategy({ onBlocked });
      const options = strategy['options'];

      expect(options.onBlocked).toBe(onBlocked);
    });

    it('accepts logLevel option', () => {
      const strategy = new ServiceWorkerStrategy({ logLevel: 'silent' });
      const options = strategy['options'];

      expect(options.logLevel).toBe('silent');
    });

    it('generates a unique tabId', () => {
      const strategy = new ServiceWorkerStrategy();
      const tabId = strategy['tabId'];

      expect(tabId).toBeDefined();
      expect(typeof tabId).toBe('string');
      expect(tabId).toMatch(/^\d+-\d+\.\d+$/);
    });

    it('generates tabId with expected format', () => {
      const strategy = new ServiceWorkerStrategy();
      const tabId = strategy['tabId'];

      expect(tabId).toMatch(/^\d+-\d+\.\d+$/);
    });

    it('does not throw if sessionStorage access fails', () => {
      const originalSessionStorage = mockWindow.sessionStorage;
      mockWindow.sessionStorage = {
        getItem: () => { throw new Error('fail'); },
        setItem: () => { throw new Error('fail'); },
        removeItem: () => { throw new Error('fail'); },
        clear: () => { throw new Error('fail'); },
        key: () => null,
        length: 0,
      } as unknown as Storage;

      expect(() => new ServiceWorkerStrategy()).not.toThrow();

      mockWindow.sessionStorage = originalSessionStorage;
    });
  });

  describe('start', () => {
    it('does not start twice if start is called multiple times', () => {
      const strategy = new ServiceWorkerStrategy();
      const registerAndStartSpy = jest.spyOn(strategy as any, 'registerAndStart');

      strategy.start();
      strategy.start();

      expect(registerAndStartSpy).toHaveBeenCalledTimes(1);
    });

    it('sets isStarted to true after starting', () => {
      const strategy = new ServiceWorkerStrategy();
      strategy.start();

      expect(strategy['isStarted']).toBe(true);
    });

    it('handles missing serviceWorker by calling onBlocked', async () => {
      const onBlocked = jest.fn();
      const strategy = new ServiceWorkerStrategy({ onBlocked });

      (global.navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker = undefined;

      strategy.start();
      await Promise.resolve();
      jest.runAllTimers();

      expect(onBlocked).toHaveBeenCalled();
    });

    it('registers service worker when serviceWorker is available', async () => {
      const strategy = new ServiceWorkerStrategy({ swPath: '/test/sw.js' });
      strategy.start();

      await Promise.resolve();
      jest.runAllTimers();

      expect(serviceWorkerContainer.register).toHaveBeenCalledWith('/test/sw.js', { scope: '/' });
    });
  });

  describe('stop', () => {
    it('is no-op if not started', () => {
      const strategy = new ServiceWorkerStrategy();

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat');
      const removeMessageListenerSpy = jest.spyOn(strategy as any, 'removeMessageListener');

      strategy.stop();

      expect(stopHeartbeatSpy).not.toHaveBeenCalled();
      expect(removeMessageListenerSpy).not.toHaveBeenCalled();
    });

    it('clears isStarted after stopping', () => {
      const strategy = new ServiceWorkerStrategy();
      strategy['isStarted'] = true;

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
      const removeMessageListenerSpy = jest.spyOn(strategy as any, 'removeMessageListener').mockImplementation(() => {});

      strategy.stop();

      expect(strategy['isStarted']).toBe(false);
      stopHeartbeatSpy.mockRestore();
      removeMessageListenerSpy.mockRestore();
    });

    it('clears registration after stopping', () => {
      const strategy = new ServiceWorkerStrategy();
      strategy['isStarted'] = true;
      strategy['registration'] = {} as ServiceWorkerRegistration;

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
      const removeMessageListenerSpy = jest.spyOn(strategy as any, 'removeMessageListener').mockImplementation(() => {});

      strategy.stop();

      expect(strategy['registration']).toBeNull();
      stopHeartbeatSpy.mockRestore();
      removeMessageListenerSpy.mockRestore();
    });

    it('calls stopHeartbeat when started', () => {
      const strategy = new ServiceWorkerStrategy();
      strategy['isStarted'] = true;

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
      const removeMessageListenerSpy = jest.spyOn(strategy as any, 'removeMessageListener').mockImplementation(() => {});

      strategy.stop();

      expect(stopHeartbeatSpy).toHaveBeenCalled();
      stopHeartbeatSpy.mockRestore();
      removeMessageListenerSpy.mockRestore();
    });

    it('calls removeMessageListener when started', () => {
      const strategy = new ServiceWorkerStrategy();
      strategy['isStarted'] = true;

      const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
      const removeMessageListenerSpy = jest.spyOn(strategy as any, 'removeMessageListener').mockImplementation(() => {});

      strategy.stop();

      expect(removeMessageListenerSpy).toHaveBeenCalled();
      stopHeartbeatSpy.mockRestore();
      removeMessageListenerSpy.mockRestore();
    });
  });

  describe('isActive', () => {
    it('returns false by default', () => {
      const strategy = new ServiceWorkerStrategy();

      expect(strategy.isActive()).toBe(false);
    });

    it('returns true when active flag is set', () => {
      const strategy = new ServiceWorkerStrategy();
      strategy['active'] = true;

      expect(strategy.isActive()).toBe(true);
    });
  });

  describe('takeover', () => {
    it('does nothing if no controller', () => {
      const strategy = new ServiceWorkerStrategy();

      serviceWorkerContainer.controller = null;

      strategy.takeover();

      expect(controllerMock.postMessage).not.toHaveBeenCalled();
    });

    it('posts take_over message with tabId when controller exists', () => {
      const strategy = new ServiceWorkerStrategy();
      const tabId = strategy['tabId'];

      strategy.takeover();

      expect(controllerMock.postMessage).toHaveBeenCalledWith({
        type: EVENTS.TAKE_OVER,
        tabId,
      });
    });
  });

  describe('startHeartbeat', () => {
    it('starts periodic messages at heartbeatInterval', () => {
      const strategy = new ServiceWorkerStrategy({ heartbeatInterval: 1000 });

      controllerMock.postMessage = jest.fn();
      serviceWorkerContainer.controller = controllerMock as unknown as ServiceWorker;

      strategy.startHeartbeat();

      expect(controllerMock.postMessage).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      expect(controllerMock.postMessage).toHaveBeenCalledTimes(1);
      expect(controllerMock.postMessage).toHaveBeenCalledWith({
        type: EVENTS.PING,
        tabId: strategy['tabId'],
      });

      jest.advanceTimersByTime(1000);
      expect(controllerMock.postMessage).toHaveBeenCalledTimes(2);
    });

    it('clears existing timer before starting new one', () => {
      const strategy = new ServiceWorkerStrategy({ heartbeatInterval: 1000 });

      controllerMock.postMessage = jest.fn();
      serviceWorkerContainer.controller = controllerMock as unknown as ServiceWorker;

      strategy.startHeartbeat();
      strategy.startHeartbeat();

      jest.advanceTimersByTime(1000);
      expect(controllerMock.postMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopHeartbeat', () => {
    it('is safe to call when no timer exists', () => {
      const strategy = new ServiceWorkerStrategy();

      expect(() => strategy.stopHeartbeat()).not.toThrow();
    });

    it('can be called after startHeartbeat', () => {
      const strategy = new ServiceWorkerStrategy({ heartbeatInterval: 1000 });

      expect(() => {
        strategy.startHeartbeat();
        strategy.stopHeartbeat();
      }).not.toThrow();
    });
  });

  describe('addMessageListener', () => {
    it('is safe to call multiple times', () => {
      const strategy = new ServiceWorkerStrategy();

      expect(() => strategy.addMessageListener()).not.toThrow();
      expect(() => strategy.addMessageListener()).not.toThrow();
    });
  });

  describe('removeMessageListener', () => {
    it('is safe to call when no messageHandler exists', () => {
      const strategy = new ServiceWorkerStrategy();

      expect(() => strategy.removeMessageListener()).not.toThrow();
    });

    it('is safe to call multiple times', () => {
      const strategy = new ServiceWorkerStrategy();

      expect(() => strategy.removeMessageListener()).not.toThrow();
      expect(() => strategy.removeMessageListener()).not.toThrow();
    });
  });

describe('requestAmIActive', () => {
    it('handles missing serviceWorker gracefully', () => {
      const onBlocked = jest.fn();
      const strategy = new ServiceWorkerStrategy({ onBlocked });

      serviceWorkerContainer.controller = null;

      expect(() => strategy.start()).not.toThrow();
    });
  });

describe('error handling', () => {
    it('handles missing serviceWorker gracefully', () => {
      const onBlocked = jest.fn();
      const strategy = new ServiceWorkerStrategy({ onBlocked });

      (global as any).navigator.serviceWorker = undefined;

      strategy.start();

      expect(onBlocked).toHaveBeenCalled();
    });
  });
});