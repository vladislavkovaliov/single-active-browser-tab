import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceWorkerStrategy } from './index';
import { DEFAULT_HEARTBEAT_INTERVAL, DEFAULT_SW_PATH, EVENTS } from './constants';

declare global {
  interface Window {
    sessionStorage?: Storage;
  }

  interface Navigator {
    serviceWorker: ServiceWorkerContainer;
  }
}

describe('ServiceWorkerStrategy', () => {
  let originalNavigator: Navigator;
  let originalWindow: typeof window;
  let controllerMock: { postMessage: jest.Mock } | null;

  beforeEach(() => {
    jest.useFakeTimers();

    // Save originals
    // @ts-expect-error test env
    originalNavigator = global.navigator;
    // @ts-expect-error test env
    originalWindow = global.window;

    // Minimal sessionStorage mock
    const storageData = new Map<string, string>();
    const sessionStorage: Storage = {
      length: 0,
      clear: () => {
        storageData.clear();
      },
      getItem: (key: string) => storageData.get(key) ?? null,
      key: (index: number) => Array.from(storageData.keys())[index] ?? null,
      removeItem: (key: string) => {
        storageData.delete(key);
      },
      setItem: (key: string, value: string) => {
        storageData.set(key, value);
      },
    };

    controllerMock = {
      postMessage: jest.fn(),
    };

    const readyPromise = Promise.resolve({} as ServiceWorkerRegistration);

    const registration: Partial<ServiceWorkerRegistration> = {
      scope: '/',
      update: jest.fn(),
      addEventListener: jest.fn(),
      waiting: undefined,
    };

    const serviceWorkerContainer: Partial<ServiceWorkerContainer> = {
      controller: controllerMock as unknown as ServiceWorker,
      register: jest.fn().mockResolvedValue(registration as ServiceWorkerRegistration),
      ready: readyPromise,
      addEventListener: jest.fn(),
    };

    const navigatorMock = {
      serviceWorker: serviceWorkerContainer as ServiceWorkerContainer,
    } as Navigator;

    // Attach mocks to global and window so `navigator` and `window.navigator`
    // both see the same object in the jsdom environment.
    // @ts-expect-error test env
    global.navigator = navigatorMock;
    // @ts-expect-error test env
    global.window = {
      ...(global.window || {}),
      sessionStorage,
      navigator: navigatorMock,
    } as unknown as Window;
  });

  afterEach(() => {
    jest.useRealTimers();
    // Restore globals
    // @ts-expect-error test env
    global.navigator = originalNavigator;
    // @ts-expect-error test env
    global.window = originalWindow;
  });

  it('uses default options when none provided', () => {
    const strategy = new ServiceWorkerStrategy();

    // @ts-expect-error access for test
    const options = strategy['options'];

    expect(options.swPath).toBe(DEFAULT_SW_PATH);
    expect(options.heartbeatInterval).toBe(DEFAULT_HEARTBEAT_INTERVAL);
  });

  it('reuses existing tabId from sessionStorage on subsequent instances', () => {
    const first = new ServiceWorkerStrategy();
    // @ts-expect-error access for test
    const firstId = first['tabId'];

    const second = new ServiceWorkerStrategy();
    // @ts-expect-error access for test
    const secondId = second['tabId'];

    expect(firstId).toBeDefined();
    expect(secondId).toBe(firstId);
  });

  it('does not start twice if start is called multiple times', async () => {
    const strategy = new ServiceWorkerStrategy();

    // Spy on private registerAndStart method
    // @ts-expect-error access for test
    const registerAndStartSpy = jest.spyOn(strategy as any, 'registerAndStart');

    strategy.start();
    strategy.start();

    expect(registerAndStartSpy).toHaveBeenCalledTimes(1);
  });

  it('stop is a no-op if not started', () => {
    const strategy = new ServiceWorkerStrategy();

    // @ts-expect-error access for test
    const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat');
    // @ts-expect-error access for test
    const removeMessageListenerSpy = jest.spyOn(strategy as any, 'removeMessageListener');

    strategy.stop();

    expect(stopHeartbeatSpy).not.toHaveBeenCalled();
    expect(removeMessageListenerSpy).not.toHaveBeenCalled();
  });

  it('isActive reflects internal active flag', () => {
    const strategy = new ServiceWorkerStrategy();

    expect(strategy.isActive()).toBe(false);

    // @ts-expect-error access for test
    strategy['active'] = true;

    expect(strategy.isActive()).toBe(true);
  });

  it('stop clears registration and calls cleanup when started', () => {
    const strategy = new ServiceWorkerStrategy();

    // Pretend it has been started and has a registration
    // @ts-expect-error access for test
    strategy['isStarted'] = true;
    // @ts-expect-error access for test
    strategy['registration'] = {} as ServiceWorkerRegistration;

    // Spy and stub internal cleanup to avoid touching real globals
    // @ts-expect-error access for test
    const stopHeartbeatSpy = jest.spyOn(strategy as any, 'stopHeartbeat').mockImplementation(() => {});
    // @ts-expect-error access for test
    const removeMessageListenerSpy = jest
      .spyOn(strategy as any, 'removeMessageListener')
      .mockImplementation(() => {});

    strategy.stop();

    expect(stopHeartbeatSpy).toHaveBeenCalled();
    expect(removeMessageListenerSpy).toHaveBeenCalled();
    // @ts-expect-error access for test
    expect(strategy['isStarted']).toBe(false);
    // @ts-expect-error access for test
    expect(strategy['registration']).toBeNull();
  });

  it('constructor does not throw if sessionStorage access fails', () => {
    // Make sessionStorage throw on access
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

    expect(() => new ServiceWorkerStrategy()).not.toThrow();

    // Restore
    // @ts-expect-error test env
    window.sessionStorage = originalSessionStorage;
  });
});

