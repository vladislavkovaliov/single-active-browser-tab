/**
 * Common contract for strategies that coordinate a single active browser tab.
 */
interface TabStrategy {
    /**
     * Initialize and start the strategy.
     */
    start(): void;
    /**
     * Stop the strategy and release any resources.
     */
    stop(): void;
    /**
     * Returns whether this strategy considers the current tab active.
     */
    isActive?(): boolean;
    /**
     * Force this tab to become active, if the strategy supports it.
     */
    takeover?(): void;
}

type StrategyType = 'sw' | 'broadcast';
interface SingleTabManagerOptions {
    onActive?: () => void;
    onBlocked?: () => void;
    swPath?: string;
    heartbeatInterval?: number;
    staleTimeout?: number;
}
declare class SingleTabManager {
    protected readonly strategy: TabStrategy;
    private readonly strategies;
    constructor(strategy?: StrategyType, options?: SingleTabManagerOptions);
    start(): void;
    stop(): void;
    isActive(): boolean;
    /** Take over as the active tab; other tabs will receive onBlocked. */
    takeover(): void;
}

export { SingleTabManager, type SingleTabManagerOptions };
