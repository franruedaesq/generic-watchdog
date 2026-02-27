import { NodeType, Severity, SystemStateStatus } from "./types.js";
/**
 * The main Watchdog class that acts as the registry for all monitored nodes
 * and provides a built-in Pub/Sub event emitter.
 */
export class Watchdog {
    constructor() {
        this.nodes = new Map();
        this.listeners = new Map();
        this.nodeStates = new Map();
        this.passiveTimers = new Map();
        this.activeIntervals = new Map();
        this.activeInFlight = new Set();
        this.started = false;
    }
    /**
     * Registers a node configuration with the Watchdog.
     * @throws {Error} if a node with the same id is already registered.
     */
    registerNode(config) {
        if (this.nodes.has(config.id)) {
            throw new Error(`Node with id "${config.id}" is already registered.`);
        }
        this.nodes.set(config.id, config);
        this.nodeStates.set(config.id, {
            healthy: true,
            lastSeen: null,
            consecutiveSuccesses: 0,
            consecutiveFailures: 0,
        });
        if (this.started) {
            this.startNodeMonitoring(config.id, config);
        }
    }
    /**
     * Unregisters a node and immediately clears all associated timers and state.
     * @throws {Error} if the node is not registered.
     */
    unregisterNode(id) {
        if (!this.nodes.has(id)) {
            throw new Error(`Node with id "${id}" is not registered.`);
        }
        const passiveTimer = this.passiveTimers.get(id);
        if (passiveTimer !== undefined) {
            clearTimeout(passiveTimer);
            this.passiveTimers.delete(id);
        }
        const activeInterval = this.activeIntervals.get(id);
        if (activeInterval !== undefined) {
            clearInterval(activeInterval);
            this.activeIntervals.delete(id);
        }
        this.activeInFlight.delete(id);
        this.nodeStates.delete(id);
        this.nodes.delete(id);
    }
    /**
     * Retrieves the configuration of a registered node by its id.
     * @returns The NodeConfig, or undefined if not found.
     */
    getNode(id) {
        return this.nodes.get(id);
    }
    /**
     * Returns a read-only status snapshot of a specific monitored node.
     * @returns The NodeStatus, or undefined if not found.
     */
    getNodeStatus(id) {
        const state = this.nodeStates.get(id);
        if (!state)
            return undefined;
        return {
            id,
            healthy: state.healthy,
            lastSeen: state.lastSeen,
            consecutiveSuccesses: state.consecutiveSuccesses,
            consecutiveFailures: state.consecutiveFailures,
        };
    }
    /**
     * Returns a snapshot of the overall system state.
     */
    getSystemState() {
        const nodes = {};
        for (const [id, state] of this.nodeStates) {
            nodes[id] = {
                id,
                healthy: state.healthy,
                lastSeen: state.lastSeen,
                consecutiveSuccesses: state.consecutiveSuccesses,
                consecutiveFailures: state.consecutiveFailures,
            };
        }
        return { status: this.computeSystemStatus(), nodes };
    }
    computeSystemStatus() {
        let status = SystemStateStatus.HEALTHY;
        for (const [id, state] of this.nodeStates) {
            if (!state.healthy) {
                const config = this.nodes.get(id);
                if (config.severity === Severity.FATAL) {
                    return SystemStateStatus.CRITICAL;
                }
                if (config.severity === Severity.WARNING) {
                    status = SystemStateStatus.DEGRADED;
                }
            }
        }
        return status;
    }
    /**
     * Records a heartbeat ping from a PASSIVE node.
     * Updates lastSeen and resets the TTL deadline timer.
     * @throws {Error} if the node is not registered.
     */
    ping(nodeId) {
        const config = this.nodes.get(nodeId);
        if (!config) {
            throw new Error(`Node with id "${nodeId}" is not registered.`);
        }
        const state = this.nodeStates.get(nodeId);
        state.lastSeen = Date.now();
        if (!state.healthy) {
            state.consecutiveSuccesses++;
            if (state.consecutiveSuccesses >= config.recoveryThreshold) {
                state.healthy = true;
                state.consecutiveFailures = 0;
                this.emit("onNodeRecovered", { nodeId, config });
                this.emitSystemStateChange();
            }
        }
        else {
            state.consecutiveSuccesses++;
        }
        this.schedulePassiveTtlCheck(nodeId);
    }
    schedulePassiveTtlCheck(nodeId) {
        const config = this.nodes.get(nodeId);
        const existing = this.passiveTimers.get(nodeId);
        if (existing !== undefined) {
            clearTimeout(existing);
        }
        const handle = setTimeout(() => {
            this.onPassiveTtlExpired(nodeId);
        }, config.intervalMs + config.gracePeriodMs);
        this.passiveTimers.set(nodeId, handle);
    }
    onPassiveTtlExpired(nodeId) {
        if (!this.nodeStates.has(nodeId))
            return;
        this.markNodeUnhealthy(nodeId);
    }
    markNodeUnhealthy(nodeId) {
        const state = this.nodeStates.get(nodeId);
        const wasHealthy = state.healthy;
        state.healthy = false;
        state.consecutiveSuccesses = 0;
        state.consecutiveFailures++;
        if (wasHealthy) {
            const config = this.nodes.get(nodeId);
            this.emit("onNodeFailure", { nodeId, config });
            this.emitSystemStateChange();
        }
    }
    emitSystemStateChange() {
        const state = this.getSystemState();
        this.emit("onSystemStateChange", state);
        if (state.status === SystemStateStatus.CRITICAL) {
            this.emit("onSystemCritical", state);
        }
    }
    /**
     * Starts the background monitoring loop for all registered nodes.
     * ACTIVE nodes begin polling; PASSIVE nodes without a prior ping begin
     * their TTL countdown.
     */
    start() {
        if (this.started)
            return;
        this.started = true;
        for (const [id, config] of this.nodes) {
            this.startNodeMonitoring(id, config);
        }
    }
    startNodeMonitoring(nodeId, config) {
        if (config.type === NodeType.PASSIVE) {
            if (!this.passiveTimers.has(nodeId)) {
                this.schedulePassiveTtlCheck(nodeId);
            }
        }
        else if (config.type === NodeType.ACTIVE) {
            if (!this.activeIntervals.has(nodeId)) {
                const handle = setInterval(() => {
                    void this.runActiveHealthCheck(nodeId);
                }, config.intervalMs);
                this.activeIntervals.set(nodeId, handle);
            }
        }
    }
    async runActiveHealthCheck(nodeId) {
        const config = this.nodes.get(nodeId);
        if (!config?.healthCheckFn)
            return;
        if (this.activeInFlight.has(nodeId))
            return;
        this.activeInFlight.add(nodeId);
        let timeoutId;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error("Health check timed out")), config.gracePeriodMs);
            });
            const result = await Promise.race([
                config.healthCheckFn(),
                timeoutPromise,
            ]);
            if (timeoutId !== undefined)
                clearTimeout(timeoutId);
            const state = this.nodeStates.get(nodeId);
            if (state) {
                state.lastSeen = Date.now();
                if (result === true) {
                    if (!state.healthy) {
                        state.consecutiveSuccesses++;
                        if (state.consecutiveSuccesses >= config.recoveryThreshold) {
                            state.healthy = true;
                            state.consecutiveFailures = 0;
                            this.emit("onNodeRecovered", { nodeId, config });
                            this.emitSystemStateChange();
                        }
                    }
                    else {
                        state.consecutiveSuccesses++;
                    }
                }
                else {
                    this.markNodeUnhealthy(nodeId);
                }
            }
        }
        catch {
            if (timeoutId !== undefined)
                clearTimeout(timeoutId);
            if (this.nodeStates.has(nodeId)) {
                this.markNodeUnhealthy(nodeId);
            }
        }
        finally {
            this.activeInFlight.delete(nodeId);
        }
    }
    /**
     * Stops all background monitoring loops and clears all scheduled timers.
     */
    stop() {
        for (const handle of this.passiveTimers.values()) {
            clearTimeout(handle);
        }
        this.passiveTimers.clear();
        for (const handle of this.activeIntervals.values()) {
            clearInterval(handle);
        }
        this.activeIntervals.clear();
        this.activeInFlight.clear();
        this.started = false;
    }
    /**
     * Subscribes a listener to a named Watchdog event.
     */
    on(event, listener) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(listener);
    }
    /**
     * Unsubscribes a listener from a named Watchdog event.
     */
    off(event, listener) {
        const eventListeners = this.listeners.get(event);
        if (!eventListeners)
            return;
        const index = eventListeners.indexOf(listener);
        if (index !== -1) {
            eventListeners.splice(index, 1);
        }
    }
    /**
     * Emits a named Watchdog event, invoking all registered listeners.
     */
    emit(event, payload) {
        const eventListeners = this.listeners.get(event);
        if (!eventListeners)
            return;
        for (const listener of eventListeners) {
            listener(payload);
        }
    }
}
