import { TabStrategy } from '../sw';

import { getLoggerInstance } from '../logger';

/**
 * Configuration options for {@link BroadcastChannelStrategy}.
 */
interface IBroadcastStrategyOptions {
  heartbeatInterval?: number;
  staleTimeout?: number;
  onActive?: () => void;
  onBlocked?: () => void;
  logLevel?: 'error' | 'warn' | 'log';
  channelName?: string;
}

/**
 * Shape of the state persisted in {@link localStorage} to coordinate active tab ownership.
 */
interface BroadcastState {
  ownerId: string;
  lastSeen: number;
}

/**
 * Default timeout (in milliseconds) after which a stored tab heartbeat is considered stale.
 */
const DEFAULT_STALE_TIMEOUT = 5000;
/**
 * Default interval (in milliseconds) for writing heartbeat updates to storage.
 */
const DEFAULT_HEARTBEAT_INTERVAL = 5000;
/**
 * Default name of the {@link BroadcastChannel} used to propagate state changes.
 */
const DEFAULT_CHANNEL_NAME = 'single-tab-manager-broadcast';
/**
 * Storage key used to persist {@link BroadcastState} in {@link localStorage}.
 */
const STORAGE_KEY = 'single-tab-manager-broadcast-state';

/**
 * Tab coordination strategy that uses {@link BroadcastChannel} and {@link localStorage}
 * to ensure only a single tab is considered "active" at a time.
 */
export class BroadcastChannelStrategy implements TabStrategy {
  private readonly heartbeatInterval: number;
  private readonly staleTimeout: number;
  private readonly onActive?: () => void;
  private readonly onBlocked?: () => void;
  private readonly channelName: string;

  private readonly tabId: string;
  private readonly isReload: boolean;

  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private beforeUnloadHandler: (() => void) | null = null;
  private logLevel: 'error' | 'warn' | 'log' | undefined = undefined;

  private isStarted = false;
  private isOpen = false;
  private active = false;

  /**
   * Creates a new broadcast-channel-based tab coordination strategy.
   *
   * @param options Optional behavior overrides and lifecycle callbacks.
   * - `heartbeatInterval`: How often to write heartbeats to storage (ms).
   * - `staleTimeout`: How long before a heartbeat is treated as stale (ms).
   * - `onActive`: Called when this tab becomes the active tab.
   * - `onBlocked`: Called when this tab is blocked by another active tab.
   * - `logLevel`: Log Level to log actins.
   * - `channelName`: Custom {@link BroadcastChannel} name to use.
   */
  constructor(options: IBroadcastStrategyOptions = {}) {
    let tabId = `${Date.now()}-${Math.random()}`;
    let isReload = false;

    try {
      if (typeof window !== 'undefined' && 'sessionStorage' in window) {
        const key = 'single-tab-manager-tab-id';

        const existing = window.sessionStorage.getItem(key);

        if (existing) {
          const logLevel = options.logLevel;
          getLoggerInstance(logLevel).log(
            '[SingleTab BC] constructor: using existing tabId from sessionStorage'
          );
          tabId = existing;
          isReload = true;
        } else {
          window.sessionStorage.setItem(key, tabId);
        }
      }
    } catch {
      // ignore storage errors, fallback to random tabId
    }

    this.tabId = tabId;
    this.isReload = isReload;

    // DEFAULT_HEARTBEAT_INTERVAL.BROADCAST
    this.heartbeatInterval = options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL;
    this.staleTimeout = options.staleTimeout ?? DEFAULT_STALE_TIMEOUT;
    this.onActive = options.onActive;
    this.onBlocked = options.onBlocked;
    this.channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;

    const logLevel = options.logLevel;

    getLoggerInstance(logLevel).log(
      '[SingleTab BC] init: tabId=',
      this.tabId,
      'heartbeatInterval=',
      this.heartbeatInterval,
      'staleTimeout=',
      this.staleTimeout,
      'channelName=',
      this.channelName
    );
  }

  /**
   * Starts the strategy, wiring up storage, broadcast channel and timers.
   * Safe to call multiple times; subsequent calls are no-ops.
   */
  start(): void {
    if (this.isStarted) {
      return;
    }

    this.isStarted = true;

    this.initChannel();
    this.initBeforeUnload();

    const state = this.readState();
    const isReload = this.isReloadScenario();

    if (state === null) {
      this.becomeActive();
      this.startHeartbeat();
    } else if (state?.ownerId === this.tabId) {
      this.active = false;

      this.becomeActive();
      this.startHeartbeat();
    } else if (isReload && this.isStateStale(state)) {
      this.active = false;

      this.becomeActive();
      this.startHeartbeat();
    } else {
      this.active = false;

      if (this.onBlocked) {
        this.onBlocked();
      }
    }

    this.startCheckTimer();
  }

  /**
   * Stops the strategy, removing timers, broadcast listeners and unload handlers.
   * If this tab is currently the owner in storage, its ownership record is cleared.
   */
  stop(): void {
    if (!this.isStarted) {
      return;
    }
    this.isStarted = false;

    this.stopHeartbeat();
    this.stopCheckTimer();
    this.disposeChannel();
    this.disposeBeforeUnload();

    if (this.isActive()) {
      this.clearState();
    }
  }

  /**
   * Returns whether this tab is currently recorded as the owner in storage.
   *
   * Note: This checks persisted state only and does not consider staleness.
   */
  isActive(): boolean {
    const state = this.readState();
    const isOwner = state !== null && state.ownerId === this.tabId;
    const active = isOwner;

    return active;
  }

  /**
   * Forces this tab to become active immediately and (re)start heartbeats.
   * Does not perform additional ownership checks; callers should ensure this is desired.
   */
  takeover(): void {
    this.becomeActive();
    this.startHeartbeat();
  }

  private initChannel(): void {
    try {
      if (typeof window === 'undefined' || !(window as any).BroadcastChannel) {
        this.channel = null;

        return;
      }

      this.channel = new BroadcastChannel(this.channelName);

      this.channel.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string };

        if (!data || data.type !== 'state-changed') {
          return;
        }

        this.handleExternalStateChange();
      };
    } catch {
      this.channel = null;
    }
  }

  private disposeChannel(): void {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // ignore
      }

      this.channel = null;
    }
  }

  private broadcastStateChanged(): void {
    if (this.channel === null) {
      return;
    }

    try {
      this.channel.postMessage({ type: 'state-changed' });
    } catch {
      // ignore
    }
  }

  private initBeforeUnload(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.beforeUnloadHandler = () => {
      const logLevel = this.logLevel;

      getLoggerInstance(logLevel).log(
        '[SingleTab BC] beforeunload: keep state for potential reload'
      );
    };

    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  private disposeBeforeUnload(): void {
    if (typeof window === 'undefined' || !this.beforeUnloadHandler) {
      return;
    }

    window.removeEventListener('beforeunload', this.beforeUnloadHandler);

    this.beforeUnloadHandler = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.active) {
        this.writeState();
        this.broadcastStateChanged();
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);

      this.heartbeatTimer = null;
    }
  }

  private startCheckTimer(): void {
    this.stopCheckTimer();

    this.checkTimer = setInterval(() => {
      const state = this.readState();

      if (state === null) {
        if (!this.isActive()) {
          this.becomeActive();
          this.startHeartbeat();
        }
        return;
      }

      if (state.ownerId === this.tabId) {
        if (!this.heartbeatTimer) {
          this.startHeartbeat();
        }

        return;
      }

      // Another tab is active
      if (this.isStateStale(state)) {
        if (this.active) {
          this.becomeBlocked();
        }
      } else {
        if (this.active) {
          this.becomeBlocked();
        }
      }
    }, this.heartbeatInterval);
  }

  private stopCheckTimer(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);

      this.checkTimer = null;
    }
  }

  private handleExternalStateChange(): void {
    const state = this.readState();

    if (state === null) {
      if (!this.isActive()) {
        this.becomeActive();
        this.startHeartbeat();
      }

      return;
    }

    if (state.ownerId === this.tabId) {
      if (!this.isActive() || !this.heartbeatTimer) {
        this.becomeActive();
        this.startHeartbeat();
      }
      return;
    }

    // Another tab is active
    if (this.isStateStale(state)) {
      if (this.active) {
        this.becomeBlocked();
      }
    } else {
      this.becomeBlocked();
    }
  }

  private becomeActive(): void {
    if (this.active) {
      this.writeState();
      this.broadcastStateChanged();

      return;
    }

    this.active = true;

    this.writeState();
    this.broadcastStateChanged();

    if (this.onActive) {
      this.onActive();
    }
  }

  private becomeBlocked(): void {
    if (!this.active) {
      return;
    }

    this.active = false;

    if (this.onBlocked) {
      this.onBlocked();
    }
  }

  private readState(): BroadcastState | null {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }

      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as BroadcastState;

      return parsed;
    } catch {
      return null;
    }
  }

  // INFO: write state into local storage
  private writeState(): void {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      const state: BroadcastState = {
        ownerId: this.tabId,
        lastSeen: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  // INFO: clear local storage if tab id is owner
  private clearState(): void {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }

      const state = this.readState();
      // Only clear if we own it
      if (state && state.ownerId === this.tabId) {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }

  private isStateStale(state: BroadcastState): boolean {
    const stale = Date.now() - state.lastSeen > this.staleTimeout;

    return stale;
  }

  private isReloadScenario(): boolean {
    return this.isReload;
  }
}
