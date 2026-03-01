/**
 * Options for configuring the SingleTabManager
 */
export interface SingleTabManagerOptions {
  /** localStorage key for storing tab state (default: 'single-active-tab') */
  key?: string;
  /** Heartbeat interval in milliseconds (default: 2000) */
  heartbeatInterval?: number;
  /** Timeout after which a tab is considered stale (default: 5000) */
  staleTimeout?: number;
  /** Callback when this tab becomes blocked */
  onBlocked?: () => void;
  /** Callback when this tab becomes active */
  onActive?: () => void;
}

/**
 * State stored in localStorage
 */
interface TabState {
  id: string;
  lastSeen: number;
}

/**
 * Manager that ensures only one browser tab can be active at a time.
 * Uses a heartbeat mechanism with localStorage for cross-tab communication.
 */
export class SingleTabManager {
  private readonly key: string;
  private readonly heartbeatInterval: number;
  private readonly staleTimeout: number;
  private readonly onBlocked?: () => void;
  private readonly onActive?: () => void;

  private readonly tabId: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private isStarted = false;

  constructor(options: SingleTabManagerOptions = {}) {
    this.key = options.key ?? 'single-active-tab';
    this.heartbeatInterval = options.heartbeatInterval ?? 2000;
    this.staleTimeout = options.staleTimeout ?? 5000;
    this.onBlocked = options.onBlocked;
    this.onActive = options.onActive;

    // Generate unique tab ID: timestamp-random
    this.tabId = `${Date.now()}-${Math.random()}`;
  }

  /**
   * Start the manager - begin heartbeat and check for active tab
   */
  start(): void {
    if (this.isStarted) {
      return;
    }
    this.isStarted = true;

    // Check if we can become active
    const currentState = this.readState();

    if (currentState === null || this.isStateStale(currentState)) {
      // No active tab or stale - become active
      this.becomeActive();
    } else {
      // Another tab is active - become blocked
      this.becomeBlocked();
    }

    // Start heartbeat if active
    if (this.isActive()) {
      this.startHeartbeat();
    }

    // Start periodic check for stale active tab
    this.startCheckInterval();

    // Listen for storage events from other tabs
    this.handleStorageChange = this.handleStorageChange.bind(this);
    window.addEventListener('storage', this.handleStorageChange);

    // Listen for beforeunload to clean up
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  /**
   * Stop the manager - clean up timers and listeners
   */
  stop(): void {
    if (!this.isStarted) {
      return;
    }
    this.isStarted = false;

    // Clear timers
    this.stopHeartbeat();
    this.stopCheckInterval();

    // Remove listeners
    window.removeEventListener('storage', this.handleStorageChange);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);

    // If this tab was active, clear the state
    if (this.isActive()) {
      this.clearState();
    }
  }

  /**
   * Check if this tab is currently active
   */
  isActive(): boolean {
    const state = this.readState();
    return state !== null && state.id === this.tabId;
  }

  /**
   * Forcefully take over control from another tab
   */
  takeover(): void {
    this.becomeActive();
    this.startHeartbeat();
  }

  /**
   * Get the current tab ID
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Check if this tab is blocked (another tab is active)
   */
  isBlocked(): boolean {
    const state = this.readState();
    return state !== null && state.id !== this.tabId && !this.isStateStale(state);
  }

  private becomeActive(): void {
    this.writeState();
    if (this.onActive) {
      this.onActive();
    }
  }

  private becomeBlocked(): void {
    if (this.onBlocked) {
      this.onBlocked();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isActive()) {
        this.writeState();
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startCheckInterval(): void {
    this.stopCheckInterval();
    this.checkInterval = setInterval(() => {
      const state = this.readState();

      if (state === null) {
        // No active tab - try to become active
        if (!this.isActive()) {
          this.becomeActive();
          this.startHeartbeat();
        }
        return;
      }

      if (state.id === this.tabId) {
        // We are active - ensure heartbeat is running
        if (!this.heartbeatTimer) {
          this.startHeartbeat();
        }
        return;
      }

      // Another tab is active
      if (this.isStateStale(state)) {
        // It's stale - take over
        this.becomeActive();
        this.startHeartbeat();
      } else {
        // It's still alive - ensure we're blocked
        if (this.isActive()) {
          // We somehow became active but shouldn't be
          this.becomeBlocked();
        }
      }
    }, this.heartbeatInterval);
  }

  private stopCheckInterval(): void {
    if (this.checkInterval !== null) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private readState(): TabState | null {
    try {
      const data = localStorage.getItem(this.key);
      if (data === null) {
        return null;
      }
      return JSON.parse(data) as TabState;
    } catch {
      return null;
    }
  }

  private writeState(): void {
    try {
      const state: TabState = {
        id: this.tabId,
        lastSeen: Date.now(),
      };
      localStorage.setItem(this.key, JSON.stringify(state));
    } catch {
      // localStorage might be unavailable or full
    }
  }

  private clearState(): void {
    try {
      const state = this.readState();
      // Only clear if we own it
      if (state !== null && state.id === this.tabId) {
        localStorage.removeItem(this.key);
      }
    } catch {
      // Ignore errors
    }
  }

  private isStateStale(state: TabState): boolean {
    return Date.now() - state.lastSeen > this.staleTimeout;
  }

  private handleStorageChange(event: StorageEvent): void {
    // Only react to changes in our key
    if (event.key !== this.key) {
      return;
    }

    // Storage event doesn't fire in the tab that made the change
    // So we need to re-read the state
    const state = this.readState();

    if (state === null) {
      // Active tab was closed - try to become active
      if (!this.isActive()) {
        this.becomeActive();
        this.startHeartbeat();
      }
      return;
    }

    if (state.id === this.tabId) {
      // Our state - we should be active
      if (!this.isActive() || !this.heartbeatTimer) {
        this.becomeActive();
        this.startHeartbeat();
      }
      return;
    }

    // Another tab is active
    if (this.isStateStale(state)) {
      // It's stale - take over
      this.becomeActive();
      this.startHeartbeat();
    } else {
      // It's alive - we should be blocked
      this.becomeBlocked();
    }
  }

  private handleBeforeUnload(): void {
    if (this.isActive()) {
      this.clearState();
    }
  }
}

/**
 * Factory function to create a SingleTabManager instance
 */
export function createSingleTabManager(options: SingleTabManagerOptions = {}): SingleTabManager {
  return new SingleTabManager(options);
}
