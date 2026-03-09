import { TabStrategy } from '../sw';

interface IBroadcastStrategyOptions {
  heartbeatInterval?: number;
  staleTimeout?: number;
  onActive?: () => void;
  onBlocked?: () => void;
  channelName?: string;
}

interface BroadcastState {
  ownerId: string;
  lastSeen: number;
}

const DEFAULT_STALE_TIMEOUT = 5000;
const DEFAULT_HEARTBEAT_INTERVAL = 5000;
const DEFAULT_CHANNEL_NAME = 'single-tab-manager-broadcast';
const STORAGE_KEY = 'single-tab-manager-broadcast-state';

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

  private isStarted = false;
  private isOpen = false;
  private active = false;

  constructor(options: IBroadcastStrategyOptions = {}) {
    let tabId = `${Date.now()}-${Math.random()}`;
    let isReload = false;

    try {
      if (typeof window !== 'undefined' && 'sessionStorage' in window) {
        const key = 'single-tab-manager-tab-id';

        const existing = window.sessionStorage.getItem(key);

        if (existing) {
          console.log('[SingleTab BC] constructor: using existing tabId from sessionStorage');
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

    console.log(
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

  isActive(): boolean {
    const state = this.readState();
    const isOwner = state !== null && state.ownerId === this.tabId;
    const stale = state ? this.isStateStale(state) : false;

    const active = isOwner;

    return active;
  }

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
      console.log('[SingleTab BC] beforeunload: keep state for potential reload');
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
