import { createSingleTabManager, SingleTabManager } from './SingleTabManager';

describe('SingleTabManager', () => {
  let originalLocalStorage: Storage;
  let storageListeners: Array<(event: StorageEvent) => void>;
  let beforeUnloadHandlers: Array<() => void>;
  let mockNow: number;

  beforeEach(() => {
    // Save original localStorage
    originalLocalStorage = global.localStorage;

    // Reset mock time
    mockNow = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => mockNow);

    // Track storage event listeners
    storageListeners = [];
    beforeUnloadHandlers = [];

    // Mock localStorage
    const localStorageMock = (() => {
      let store: Record<string, string> = {};

      return {
        getItem: jest.fn((key: string) => store[key] ?? null),
        setItem: jest.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
          delete store[key];
        }),
        clear: jest.fn(() => {
          store = {};
        }),
        get store() {
          return store;
        },
      };
    })();

    Object.defineProperty(global, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Mock window.addEventListener for storage and beforeunload events
    jest.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'storage') {
        storageListeners.push(handler as (event: StorageEvent) => void);
      } else if (event === 'beforeunload') {
        beforeUnloadHandlers.push(handler as () => void);
      }
    });

    jest.spyOn(window, 'removeEventListener').mockImplementation((event, handler) => {
      if (event === 'storage') {
        storageListeners = storageListeners.filter((h) => h !== handler);
      }
    });

    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    // Restore original localStorage
    Object.defineProperty(global, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
    });

    jest.restoreAllMocks();
  });

  // Helper to trigger storage event
  const triggerStorageEvent = (key: string, newValue: string | null) => {
    const event = new StorageEvent('storage', {
      key,
      newValue,
    });
    storageListeners.forEach((handler) => handler(event));
  };

  // Helper to advance time
  const advanceTime = (ms: number) => {
    mockNow += ms;
  };

  describe('constructor', () => {
    it('should create manager with default options', () => {
      const manager = createSingleTabManager();
      expect(manager).toBeInstanceOf(SingleTabManager);
    });

    it('should create manager with custom options', () => {
      const onBlocked = jest.fn();
      const onActive = jest.fn();
      const manager = createSingleTabManager({
        key: 'custom-key',
        heartbeatInterval: 1000,
        staleTimeout: 3000,
        onBlocked,
        onActive,
      });
      expect(manager).toBeInstanceOf(SingleTabManager);
    });

    it('should generate unique tabId', () => {
      const manager1 = createSingleTabManager();
      const manager2 = createSingleTabManager();
      expect(manager1.getTabId()).not.toBe(manager2.getTabId());
    });

    it('should generate tabId in correct format', () => {
      const manager = createSingleTabManager();
      const tabId = manager.getTabId();
      const parts = tabId.split('-');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toMatch(/^\d+$/); // timestamp
      expect(parts[1]).toMatch(/^\d+\.\d+$/); // random
    });
  });

  describe('start()', () => {
    it('should become active when no other tab exists', () => {
      const onActive = jest.fn();
      const manager = createSingleTabManager({ onActive });

      manager.start();

      expect(manager.isActive()).toBe(true);
      expect(onActive).toHaveBeenCalledTimes(1);
    });

    it('should become blocked when another active tab exists', () => {
      const onBlocked = jest.fn();
      const manager = createSingleTabManager({ onBlocked });

      // Simulate existing active tab
      const existingState = {
        id: 'other-tab',
        lastSeen: Date.now(),
      };
      localStorage.setItem('single-active-tab', JSON.stringify(existingState));

      manager.start();

      expect(manager.isActive()).toBe(false);
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('should become active when existing tab is stale', () => {
      const onActive = jest.fn();
      const manager = createSingleTabManager({ onActive, staleTimeout: 5000 });

      // Simulate stale active tab
      const existingState = {
        id: 'stale-tab',
        lastSeen: Date.now() - 6000, // 6 seconds ago
      };
      localStorage.setItem('single-active-tab', JSON.stringify(existingState));

      manager.start();

      expect(manager.isActive()).toBe(true);
      expect(onActive).toHaveBeenCalledTimes(1);
    });

    it('should not start twice', () => {
      const onActive = jest.fn();
      const manager = createSingleTabManager({ onActive });

      manager.start();
      manager.start();

      expect(onActive).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop()', () => {
    it('should clear state when stopping active tab', () => {
      const manager = createSingleTabManager();
      manager.start();
      expect(manager.isActive()).toBe(true);

      manager.stop();

      expect(localStorage.getItem('single-active-tab')).toBeNull();
    });

    it('should not clear state when stopping blocked tab', () => {
      const otherState = {
        id: 'other-tab',
        lastSeen: Date.now(),
      };
      localStorage.setItem('single-active-tab', JSON.stringify(otherState));

      const manager = createSingleTabManager();
      manager.start();
      expect(manager.isActive()).toBe(false);

      manager.stop();

      // Other tab's state should remain
      expect(localStorage.getItem('single-active-tab')).toBe(JSON.stringify(otherState));
    });

    it('should be idempotent', () => {
      const manager = createSingleTabManager();
      manager.start();
      manager.stop();
      manager.stop(); // Should not throw
    });
  });

  describe('isActive()', () => {
    it('should return true when this tab is active', () => {
      const manager = createSingleTabManager();
      manager.start();
      expect(manager.isActive()).toBe(true);
    });

    it('should return false when another tab is active', () => {
      const otherState = {
        id: 'other-tab',
        lastSeen: Date.now(),
      };
      localStorage.setItem('single-active-tab', JSON.stringify(otherState));

      const manager = createSingleTabManager();
      manager.start();

      expect(manager.isActive()).toBe(false);
    });

    it('should return false before start()', () => {
      const manager = createSingleTabManager();
      expect(manager.isActive()).toBe(false);
    });
  });

  describe('takeover()', () => {
    it('should take over when another tab is active', () => {
      const otherState = {
        id: 'other-tab',
        lastSeen: Date.now(),
      };
      localStorage.setItem('single-active-tab', JSON.stringify(otherState));

      const manager = createSingleTabManager();
      manager.start();
      expect(manager.isActive()).toBe(false);

      manager.takeover();

      expect(manager.isActive()).toBe(true);
      const state = JSON.parse(localStorage.getItem('single-active-tab')!);
      expect(state.id).toBe(manager.getTabId());
    });

    it('should work without start()', () => {
      const manager = createSingleTabManager();
      manager.takeover();
      expect(manager.isActive()).toBe(true);
    });
  });

  describe('isBlocked()', () => {
    it('should return true when another tab is active', () => {
      const otherState = {
        id: 'other-tab',
        lastSeen: Date.now(),
      };
      localStorage.setItem('single-active-tab', JSON.stringify(otherState));

      const manager = createSingleTabManager();
      manager.start();

      expect(manager.isBlocked()).toBe(true);
    });

    it('should return false when this tab is active', () => {
      const manager = createSingleTabManager();
      manager.start();

      expect(manager.isBlocked()).toBe(false);
    });

    it('should return false when active tab is stale', () => {
      const staleState = {
        id: 'stale-tab',
        lastSeen: Date.now() - 6000,
      };
      localStorage.setItem('single-active-tab', JSON.stringify(staleState));

      const manager = createSingleTabManager({ staleTimeout: 5000 });
      manager.start();

      expect(manager.isBlocked()).toBe(false);
    });
  });

  describe('heartbeat', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should update lastSeen at heartbeat interval', () => {
      const manager = createSingleTabManager({ heartbeatInterval: 2000 });
      manager.start();

      const initialTime = Date.now();

      // Advance time by heartbeat interval
      jest.advanceTimersByTime(2000);

      const state = JSON.parse(localStorage.getItem('single-active-tab')!);
      expect(state.lastSeen).toBeGreaterThan(initialTime);
    });

    it('should stop heartbeat on stop()', () => {
      const manager = createSingleTabManager({ heartbeatInterval: 2000 });
      manager.start();

      const stateAfterStart = JSON.parse(localStorage.getItem('single-active-tab')!);
      const lastSeenAfterStart = stateAfterStart.lastSeen;

      manager.stop();

      // After stop, state should be cleared (since tab was active)
      expect(localStorage.getItem('single-active-tab')).toBeNull();
    });
  });

  describe('storage event handling', () => {
    it('should become active when active tab closes', () => {
      const otherState = {
        id: 'other-tab',
        lastSeen: Date.now(),
      };
      localStorage.setItem('single-active-tab', JSON.stringify(otherState));

      const onActive = jest.fn();
      const manager = createSingleTabManager({ onActive });
      manager.start();

      expect(manager.isActive()).toBe(false);

      // Simulate other tab closing (clearing state)
      localStorage.removeItem('single-active-tab');
      triggerStorageEvent('single-active-tab', null);

      // After storage event, manager should detect null state and become active
      // Note: isActive() checks if state.id === tabId, which will be true after becomeActive()
      const state = JSON.parse(localStorage.getItem('single-active-tab')!);
      expect(state.id).toBe(manager.getTabId());
      expect(onActive).toHaveBeenCalledTimes(1);
    });

    it('should become blocked when another tab becomes active', () => {
      const manager = createSingleTabManager();
      manager.start();
      expect(manager.isActive()).toBe(true);

      // Simulate another tab taking over
      const otherState = {
        id: 'other-tab',
        lastSeen: Date.now(),
      };
      localStorage.setItem('single-active-tab', JSON.stringify(otherState));
      triggerStorageEvent('single-active-tab', JSON.stringify(otherState));

      // isBlocked checks if another tab's state exists and is not stale
      expect(manager.isBlocked()).toBe(true);
    });

    it('should ignore storage events for other keys', () => {
      const manager = createSingleTabManager();
      manager.start();
      expect(manager.isActive()).toBe(true);

      // Trigger event for different key
      triggerStorageEvent('other-key', 'some-value');

      expect(manager.isActive()).toBe(true);
    });
  });

  describe('beforeunload handling', () => {
    it('should clear state on beforeunload when active', () => {
      const manager = createSingleTabManager();
      manager.start();
      expect(manager.isActive()).toBe(true);

      // Trigger beforeunload handlers
      beforeUnloadHandlers.forEach((handler) => handler());

      expect(localStorage.getItem('single-active-tab')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle localStorage errors gracefully', () => {
      jest.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('localStorage full');
      });

      const manager = createSingleTabManager();
      expect(() => manager.start()).not.toThrow();
    });

    it('should handle malformed JSON in localStorage', () => {
      localStorage.setItem('single-active-tab', 'invalid-json');

      const manager = createSingleTabManager();
      manager.start();

      // Should become active since existing state is invalid
      expect(manager.isActive()).toBe(true);
    });

    it('should handle concurrent start with same timestamp', () => {
      // Mock Date.now to return same value
      const fixedTime = 1234567890;
      jest.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const manager1 = createSingleTabManager();
      const manager2 = createSingleTabManager();

      // Even with same timestamp, random part should make IDs unique
      expect(manager1.getTabId()).not.toBe(manager2.getTabId());
    });
  });

  describe('callbacks', () => {
    it('should call onActive when becoming active', () => {
      const onActive = jest.fn();
      const manager = createSingleTabManager({ onActive });

      manager.start();

      expect(onActive).toHaveBeenCalledTimes(1);
    });

    it('should call onBlocked when becoming blocked', () => {
      const onBlocked = jest.fn();

      const existingState = {
        id: 'other-tab',
        lastSeen: Date.now(),
      };
      localStorage.setItem('single-active-tab', JSON.stringify(existingState));

      const manager = createSingleTabManager({ onBlocked });
      manager.start();

      expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('should call onActive when taking over stale tab', () => {
      const onActive = jest.fn();

      const staleState = {
        id: 'stale-tab',
        lastSeen: Date.now() - 6000,
      };
      localStorage.setItem('single-active-tab', JSON.stringify(staleState));

      const manager = createSingleTabManager({ onActive, staleTimeout: 5000 });
      manager.start();

      expect(onActive).toHaveBeenCalledTimes(1);
    });
  });
});
