"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/single-tab-manager.ts
var single_tab_manager_exports = {};
__export(single_tab_manager_exports, {
  SingleTabManager: () => SingleTabManager
});
module.exports = __toCommonJS(single_tab_manager_exports);

// src/core/sw/constants.ts
var DEFAULT_SW_PATH = "/sw.js";
var DEFAULT_HEARTBEAT_INTERVAL = 2e3;
var EVENTS = {
  TAKE_OVER: "take_over",
  SKIP_WAITING: "skipWaiting",
  PING: "ping",
  AM_I_ACTIVE: "am-i-active"
};

// src/core/logger/index.ts
var import_wi_console_logger = require("wi-console-logger");
function resolveLogLevel() {
  const raw = typeof process !== "undefined" && process.env ? process.env.LOG_LEVEL ?? process.env.VITE_LOG_LEVEL : void 0;
  if (raw === "warn" || raw === "log" || raw === "error") {
    return raw;
  }
  return "error";
}
var instance = void 0;
function getLoggerInstance() {
  if (instance) {
    return instance;
  } else {
    instance = new import_wi_console_logger.Logger({
      level: resolveLogLevel(),
      transform: {
        colors: {
          log: { background: "white", font: "black" },
          warn: { background: "orange", font: "black" },
          error: { background: "red", font: "black" }
        }
      }
    });
    return instance;
  }
}

// src/core/sw/index.ts
var ServiceWorkerStrategy = class {
  options;
  tabId;
  registration = null;
  heartbeatTimer = null;
  messageHandler = null;
  isStarted = false;
  active = false;
  /**
   * Creates a new service worker strategy instance.
   *
   * @param options Optional configuration:
   *  - `swPath`: Path to the service worker script.
   *  - `heartbeatInterval`: Interval (ms) between heartbeat messages.
   *  - `onActive`: Callback invoked when this tab becomes active.
   *  - `onBlocked`: Callback invoked when this tab is blocked.
   */
  constructor(options = {}) {
    let tabId = `${Date.now()}-${Math.random()}`;
    try {
      if (typeof window !== "undefined" && "sessionStorage" in window) {
        const key = "single-tab-manager-tab-id";
        const existing = window.sessionStorage.getItem(key);
        if (existing) {
          tabId = existing;
        } else {
          window.sessionStorage.setItem(key, tabId);
        }
      }
    } catch {
    }
    this.tabId = tabId;
    this.options = {
      swPath: options.swPath ?? DEFAULT_SW_PATH,
      heartbeatInterval: options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      onActive: options.onActive,
      onBlocked: options.onBlocked
    };
  }
  /**
   * Starts the strategy: registers the service worker, hooks listeners
   * and begins heartbeats if this tab is reported as active.
   */
  start() {
    getLoggerInstance().log("[SingleTab] ServiceWorkerStrategy.start()");
    if (this.isStarted) {
      return;
    }
    this.isStarted = true;
    this.registerAndStart();
  }
  /**
   * Stops the strategy: halts heartbeats, removes listeners and clears
   * the worker registration reference for this instance.
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    this.isStarted = false;
    this.stopHeartbeat();
    this.removeMessageListener();
    this.registration = null;
  }
  /**
   * Returns whether this tab is currently considered active by the strategy.
   */
  isActive() {
    return this.active;
  }
  /**
   * Take over as the active tab. This tab becomes active; other tabs receive
   * a message from the worker that they are no longer active (`onBlocked`).
   */
  takeover() {
    const controller = navigator.serviceWorker.controller;
    if (!controller) {
      return;
    }
    controller.postMessage({
      type: EVENTS.TAKE_OVER,
      tabId: this.tabId
    });
  }
  /**
   * Registers the service worker (if available) and wires up update handling,
   * message listeners and initial active-status negotiation.
   */
  async registerAndStart() {
    if ("serviceWorker" in navigator === false) {
      getLoggerInstance().log("[SingleTab] No serviceWorker in navigator");
      if (this.options.onBlocked) {
        this.options.onBlocked();
      }
      return;
    }
    try {
      getLoggerInstance().log("[SingleTab] Registering SW:", this.options.swPath);
      this.registration = await navigator.serviceWorker.register(this.options.swPath, {
        scope: "/"
      });
      getLoggerInstance().log(
        "[SingleTab] SW registered, state:",
        this.registration.active?.state,
        this.registration.installing?.state,
        this.registration.waiting?.state
      );
      if (this.registration.waiting) {
        getLoggerInstance().log(`[SingleTab] SW waiting -> postMessage(${EVENTS.SKIP_WAITING})`);
        this.registration.waiting.postMessage({ type: EVENTS.SKIP_WAITING });
      }
      this.registration.addEventListener("updatefound", () => {
        const newWorker = this.registration?.installing;
        getLoggerInstance().log("[SingleTab] updatefound, installing:", Boolean(newWorker));
        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            getLoggerInstance().log("[SingleTab] installing statechange:", newWorker.state);
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: EVENTS.SKIP_WAITING });
            }
          });
        }
      });
      getLoggerInstance().log("[SingleTab] Waiting for navigator.serviceWorker.ready...");
      await navigator.serviceWorker.ready;
      getLoggerInstance().log("[SingleTab] ready. controller:", Boolean(navigator.serviceWorker.controller));
      this.registration.update();
      this.addMessageListener();
      if (navigator.serviceWorker.controller) {
        getLoggerInstance().log("[SingleTab] Controller exists -> requestAmIActive + maybe startHeartbeat");
        await this.requestAmIActive();
        if (this.active) {
          this.startHeartbeat();
        }
      } else {
        getLoggerInstance().log("[SingleTab] No controller -> waiting for controllerchange...");
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => {
              getLoggerInstance().log("[SingleTab] controllerchange fired");
              resolve();
            },
            { once: true }
          );
        });
        getLoggerInstance().log(
          "[SingleTab] After controllerchange -> requestAmIActive + maybe startHeartbeat"
        );
        await this.requestAmIActive();
        if (this.active) {
          this.startHeartbeat();
        }
      }
      getLoggerInstance().log("[SingleTab] registerAndStart done, active:", this.active);
    } catch (err) {
      getLoggerInstance().error("[SingleTab] registration failed", err);
      this.options.onBlocked?.();
    }
  }
  /**
   * Subscribes to `message` events from the service worker and updates
   * this tab's active state based on worker responses.
   */
  addMessageListener() {
    this.messageHandler = (event) => {
      const data = event.data;
      if (data?.type === EVENTS.AM_I_ACTIVE) {
        const wasActive = this.active;
        this.active = data.active === true;
        getLoggerInstance().log(`[SingleTab] message from SW: ${EVENTS.AM_I_ACTIVE}, active=`, this.active);
        if (!wasActive && this.active) {
          this.startHeartbeat();
        } else if (wasActive && !this.active) {
          this.stopHeartbeat();
        }
        if (this.active) {
          this.options.onActive?.();
        } else {
          this.options.onBlocked?.();
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", this.messageHandler);
    getLoggerInstance().log("[SingleTab] Message listener added");
  }
  /**
   * Removes the message listener previously attached to the service worker.
   */
  removeMessageListener() {
    if (this.messageHandler) {
      navigator.serviceWorker.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
  }
  /**
   * Asks the service worker whether this tab is active and resolves once
   * the answer has been received and local state has been updated.
   */
  requestAmIActive() {
    return new Promise((resolve) => {
      const controller = navigator.serviceWorker.controller;
      getLoggerInstance().log("[SingleTab] requestAmIActive: controller=", !!controller, "tabId=", this.tabId);
      if (!controller) {
        getLoggerInstance().warn("[SingleTab] requestAmIActive: no controller, cannot send message");
        this.options.onBlocked?.();
        resolve();
        return;
      }
      const handler = (event) => {
        const data = event.data;
        if (data?.type === EVENTS.AM_I_ACTIVE) {
          navigator.serviceWorker.removeEventListener("message", handler);
          this.active = data.active === true;
          getLoggerInstance().log("[SingleTab] requestAmIActive response: active=", this.active);
          if (this.active) {
            this.options.onActive?.();
          } else {
            this.options.onBlocked?.();
          }
          resolve();
        }
      };
      navigator.serviceWorker.addEventListener("message", handler);
      controller.postMessage({
        type: EVENTS.AM_I_ACTIVE,
        tabId: this.tabId
      });
      getLoggerInstance().log(`[SingleTab] requestAmIActive: postMessage(${EVENTS.AM_I_ACTIVE}) sent`);
    });
  }
  /**
   * Starts periodic heartbeat messages to the service worker while this
   * tab is active, informing it that the tab is still alive.
   */
  startHeartbeat() {
    this.stopHeartbeat();
    getLoggerInstance().log("[SingleTab] startHeartbeat, interval=", this.options.heartbeatInterval);
    this.heartbeatTimer = setInterval(() => {
      navigator.serviceWorker.controller?.postMessage({
        type: EVENTS.PING,
        tabId: this.tabId
      });
    }, this.options.heartbeatInterval);
  }
  /**
   * Stops sending heartbeat messages to the service worker.
   */
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
};

// src/core/broadcast/index.ts
var DEFAULT_STALE_TIMEOUT = 5e3;
var DEFAULT_HEARTBEAT_INTERVAL2 = 5e3;
var DEFAULT_CHANNEL_NAME = "single-tab-manager-broadcast";
var STORAGE_KEY = "single-tab-manager-broadcast-state";
var BroadcastChannelStrategy = class {
  heartbeatInterval;
  staleTimeout;
  onActive;
  onBlocked;
  channelName;
  tabId;
  isReload;
  channel = null;
  heartbeatTimer = null;
  checkTimer = null;
  beforeUnloadHandler = null;
  isStarted = false;
  isOpen = false;
  active = false;
  /**
   * Creates a new broadcast-channel-based tab coordination strategy.
   *
   * @param options Optional behavior overrides and lifecycle callbacks.
   * - `heartbeatInterval`: How often to write heartbeats to storage (ms).
   * - `staleTimeout`: How long before a heartbeat is treated as stale (ms).
   * - `onActive`: Called when this tab becomes the active tab.
   * - `onBlocked`: Called when this tab is blocked by another active tab.
   * - `channelName`: Custom {@link BroadcastChannel} name to use.
   */
  constructor(options = {}) {
    let tabId = `${Date.now()}-${Math.random()}`;
    let isReload = false;
    try {
      if (typeof window !== "undefined" && "sessionStorage" in window) {
        const key = "single-tab-manager-tab-id";
        const existing = window.sessionStorage.getItem(key);
        if (existing) {
          getLoggerInstance().log("[SingleTab BC] constructor: using existing tabId from sessionStorage");
          tabId = existing;
          isReload = true;
        } else {
          window.sessionStorage.setItem(key, tabId);
        }
      }
    } catch {
    }
    this.tabId = tabId;
    this.isReload = isReload;
    this.heartbeatInterval = options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL2;
    this.staleTimeout = options.staleTimeout ?? DEFAULT_STALE_TIMEOUT;
    this.onActive = options.onActive;
    this.onBlocked = options.onBlocked;
    this.channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;
    getLoggerInstance().log(
      "[SingleTab BC] init: tabId=",
      this.tabId,
      "heartbeatInterval=",
      this.heartbeatInterval,
      "staleTimeout=",
      this.staleTimeout,
      "channelName=",
      this.channelName
    );
  }
  /**
   * Starts the strategy, wiring up storage, broadcast channel and timers.
   * Safe to call multiple times; subsequent calls are no-ops.
   */
  start() {
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
  stop() {
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
  isActive() {
    const state = this.readState();
    const isOwner = state !== null && state.ownerId === this.tabId;
    const active = isOwner;
    return active;
  }
  /**
   * Forces this tab to become active immediately and (re)start heartbeats.
   * Does not perform additional ownership checks; callers should ensure this is desired.
   */
  takeover() {
    this.becomeActive();
    this.startHeartbeat();
  }
  initChannel() {
    try {
      if (typeof window === "undefined" || !window.BroadcastChannel) {
        this.channel = null;
        return;
      }
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = (event) => {
        const data = event.data;
        if (!data || data.type !== "state-changed") {
          return;
        }
        this.handleExternalStateChange();
      };
    } catch {
      this.channel = null;
    }
  }
  disposeChannel() {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
      }
      this.channel = null;
    }
  }
  broadcastStateChanged() {
    if (this.channel === null) {
      return;
    }
    try {
      this.channel.postMessage({ type: "state-changed" });
    } catch {
    }
  }
  initBeforeUnload() {
    if (typeof window === "undefined") {
      return;
    }
    this.beforeUnloadHandler = () => {
      getLoggerInstance().log("[SingleTab BC] beforeunload: keep state for potential reload");
    };
    window.addEventListener("beforeunload", this.beforeUnloadHandler);
  }
  disposeBeforeUnload() {
    if (typeof window === "undefined" || !this.beforeUnloadHandler) {
      return;
    }
    window.removeEventListener("beforeunload", this.beforeUnloadHandler);
    this.beforeUnloadHandler = null;
  }
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.active) {
        this.writeState();
        this.broadcastStateChanged();
      }
    }, this.heartbeatInterval);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  startCheckTimer() {
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
  stopCheckTimer() {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
  handleExternalStateChange() {
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
    if (this.isStateStale(state)) {
      if (this.active) {
        this.becomeBlocked();
      }
    } else {
      this.becomeBlocked();
    }
  }
  becomeActive() {
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
  becomeBlocked() {
    if (!this.active) {
      return;
    }
    this.active = false;
    if (this.onBlocked) {
      this.onBlocked();
    }
  }
  readState() {
    try {
      if (typeof localStorage === "undefined") {
        return null;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed;
    } catch {
      return null;
    }
  }
  // INFO: write state into local storage
  writeState() {
    try {
      if (typeof localStorage === "undefined") {
        return;
      }
      const state = {
        ownerId: this.tabId,
        lastSeen: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
    }
  }
  // INFO: clear local storage if tab id is owner
  clearState() {
    try {
      if (typeof localStorage === "undefined") {
        return;
      }
      const state = this.readState();
      if (state && state.ownerId === this.tabId) {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
    }
  }
  isStateStale(state) {
    const stale = Date.now() - state.lastSeen > this.staleTimeout;
    return stale;
  }
  isReloadScenario() {
    return this.isReload;
  }
};

// src/core/single-tab-manager.ts
var SingleTabManager = class {
  strategy;
  strategies;
  constructor(strategy = "sw", options) {
    const opts = options ?? {};
    this.strategies = {
      sw: new ServiceWorkerStrategy({
        onActive: opts.onActive,
        onBlocked: opts.onBlocked,
        swPath: opts.swPath,
        heartbeatInterval: opts.heartbeatInterval
      }),
      broadcast: new BroadcastChannelStrategy({
        onActive: opts.onActive,
        onBlocked: opts.onBlocked,
        heartbeatInterval: opts.heartbeatInterval,
        staleTimeout: opts.staleTimeout
      })
    };
    this.strategy = this.strategies[strategy];
  }
  start() {
    this.strategy.start();
  }
  stop() {
    this.strategy.stop();
  }
  isActive() {
    return this.strategy.isActive?.() ?? false;
  }
  /** Take over as the active tab; other tabs will receive onBlocked. */
  takeover() {
    this.strategy.takeover?.();
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SingleTabManager
});
//# sourceMappingURL=single-tab-manager.cjs.map