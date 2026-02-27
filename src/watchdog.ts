import type {
  NodeConfig,
  NodeStatus,
  SystemState,
  WatchdogEventName,
  WatchdogEventPayloads,
} from "./types.js";
import { NodeType, Severity, SystemStateStatus } from "./types.js";

interface NodeState {
  healthy: boolean;
  lastSeen: number | null;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
}

/**
 * The main Watchdog class that acts as the registry for all monitored nodes
 * and provides a built-in Pub/Sub event emitter.
 */
export class Watchdog {
  private readonly nodes: Map<string, NodeConfig> = new Map();
  private readonly listeners: Map<
    string,
    Array<(payload: unknown) => void>
  > = new Map();
  private readonly nodeStates: Map<string, NodeState> = new Map();
  private readonly passiveTimers: Map<
    string,
    ReturnType<typeof setTimeout>
  > = new Map();
  private readonly activeIntervals: Map<
    string,
    ReturnType<typeof setInterval>
  > = new Map();
  private readonly activeInFlight: Set<string> = new Set();
  private started = false;

  /**
   * Validates a NodeConfig before registration.
   * @throws {Error} if any field is invalid.
   */
  private validateConfig(config: NodeConfig): void {
    if (typeof config.id !== "string" || config.id.trim() === "") {
      throw new Error("Node id must be a non-empty string.");
    }
    if (typeof config.intervalMs !== "number" || config.intervalMs <= 0) {
      throw new Error("Node intervalMs must be a positive number.");
    }
    if (typeof config.gracePeriodMs !== "number" || config.gracePeriodMs < 0) {
      throw new Error("Node gracePeriodMs must be a non-negative number.");
    }
    if (
      typeof config.recoveryThreshold !== "number" ||
      !Number.isInteger(config.recoveryThreshold) ||
      config.recoveryThreshold < 1
    ) {
      throw new Error("Node recoveryThreshold must be a positive integer.");
    }
    if (config.type === NodeType.ACTIVE && typeof config.healthCheckFn !== "function") {
      throw new Error(
        `Node "${config.id}" is type ACTIVE but no healthCheckFn was provided.`
      );
    }
  }

  /**
   * Registers a node configuration with the Watchdog.
   * @throws {Error} if a node with the same id is already registered, or if the config is invalid.
   */
  registerNode(config: NodeConfig): void {
    this.validateConfig(config);
    if (this.nodes.has(config.id)) {
      throw new Error(`Node with id "${config.id}" is already registered.`);
    }
    // Store a frozen defensive copy so external mutation cannot corrupt internal state.
    const frozenConfig: NodeConfig = Object.freeze({ ...config });
    this.nodes.set(config.id, frozenConfig);
    this.nodeStates.set(config.id, {
      healthy: true,
      lastSeen: null,
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
    });
    if (this.started) {
      this.startNodeMonitoring(frozenConfig.id, frozenConfig);
    }
  }

  /**
   * Unregisters a node and immediately clears all associated timers and state.
   * @throws {Error} if the node is not registered.
   */
  unregisterNode(id: string): void {
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
  getNode(id: string): NodeConfig | undefined {
    return this.nodes.get(id);
  }

  /**
   * Returns a read-only status snapshot of a specific monitored node.
   * @returns The NodeStatus, or undefined if not found.
   */
  getNodeStatus(id: string): NodeStatus | undefined {
    const state = this.nodeStates.get(id);
    if (!state) return undefined;
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
  getSystemState(): SystemState {
    const nodes: Record<string, NodeStatus> = {};
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

  private computeSystemStatus(): SystemStateStatus {
    let status = SystemStateStatus.HEALTHY;
    for (const [id, state] of this.nodeStates) {
      if (!state.healthy) {
        const config = this.nodes.get(id)!;
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
   * @throws {Error} if the node is not registered or is not of type PASSIVE.
   */
  ping(nodeId: string): void {
    const config = this.nodes.get(nodeId);
    if (!config) {
      throw new Error(`Node with id "${nodeId}" is not registered.`);
    }
    if (config.type !== NodeType.PASSIVE) {
      throw new Error(
        `Node "${nodeId}" is type ACTIVE; ping() is only valid for PASSIVE nodes.`
      );
    }
    const state = this.nodeStates.get(nodeId)!;
    state.lastSeen = Date.now();

    if (!state.healthy) {
      state.consecutiveSuccesses++;
      if (state.consecutiveSuccesses >= config.recoveryThreshold) {
        state.healthy = true;
        state.consecutiveFailures = 0;
        this.emit("onNodeRecovered", { nodeId, config });
        this.emitSystemStateChange();
      }
    } else {
      state.consecutiveSuccesses++;
    }

    this.schedulePassiveTtlCheck(nodeId);
  }

  private schedulePassiveTtlCheck(nodeId: string): void {
    const config = this.nodes.get(nodeId)!;
    const existing = this.passiveTimers.get(nodeId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const handle = setTimeout(() => {
      this.onPassiveTtlExpired(nodeId);
    }, config.intervalMs + config.gracePeriodMs);
    this.passiveTimers.set(nodeId, handle);
  }

  private onPassiveTtlExpired(nodeId: string): void {
    if (!this.nodeStates.has(nodeId)) return;
    this.markNodeUnhealthy(nodeId);
  }

  private markNodeUnhealthy(nodeId: string): void {
    const state = this.nodeStates.get(nodeId)!;
    const wasHealthy = state.healthy;
    state.healthy = false;
    state.consecutiveSuccesses = 0;
    state.consecutiveFailures++;
    if (wasHealthy) {
      const config = this.nodes.get(nodeId)!;
      this.emit("onNodeFailure", { nodeId, config });
      this.emitSystemStateChange();
    }
  }

  private emitSystemStateChange(): void {
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
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const [id, config] of this.nodes) {
      this.startNodeMonitoring(id, config);
    }
  }

  private startNodeMonitoring(nodeId: string, config: NodeConfig): void {
    if (config.type === NodeType.PASSIVE) {
      if (!this.passiveTimers.has(nodeId)) {
        this.schedulePassiveTtlCheck(nodeId);
      }
    } else if (config.type === NodeType.ACTIVE) {
      if (!this.activeIntervals.has(nodeId)) {
        const handle = setInterval(() => {
          void this.runActiveHealthCheck(nodeId);
        }, config.intervalMs);
        this.activeIntervals.set(nodeId, handle);
      }
    }
  }

  private async runActiveHealthCheck(nodeId: string): Promise<void> {
    const config = this.nodes.get(nodeId);
    if (!config?.healthCheckFn) return;
    if (this.activeInFlight.has(nodeId)) return;

    this.activeInFlight.add(nodeId);

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error("Health check timed out"));
        }, config.gracePeriodMs);
      });

      // Pre-attach a catch handler so that a rejection arriving after the
      // timeout wins the race does not become an unhandled promise rejection.
      // A throwing health-check is treated as a failure (false).
      const safeHealthCheck = config.healthCheckFn(controller.signal).catch((): false => false);
      const result = await Promise.race([safeHealthCheck, timeoutPromise]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);

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
          } else {
            state.consecutiveSuccesses++;
          }
        } else {
          this.markNodeUnhealthy(nodeId);
        }
      }
    } catch {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      controller.abort();
      if (this.nodeStates.has(nodeId)) {
        this.markNodeUnhealthy(nodeId);
      }
    } finally {
      this.activeInFlight.delete(nodeId);
    }
  }

  /**
   * Stops all background monitoring loops and clears all scheduled timers.
   */
  stop(): void {
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
  on<K extends WatchdogEventName>(
    event: K,
    listener: (payload: WatchdogEventPayloads[K]) => void
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener as (payload: unknown) => void);
  }

  /**
   * Unsubscribes a listener from a named Watchdog event.
   */
  off<K extends WatchdogEventName>(
    event: K,
    listener: (payload: WatchdogEventPayloads[K]) => void
  ): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;
    const index = eventListeners.indexOf(
      listener as (payload: unknown) => void
    );
    if (index !== -1) {
      eventListeners.splice(index, 1);
    }
  }

  /**
   * Emits a named Watchdog event, invoking all registered listeners.
   * Listener errors are caught and suppressed so that one failing listener
   * cannot prevent subsequent listeners from receiving the event.
   */
  emit<K extends WatchdogEventName>(
    event: K,
    payload: WatchdogEventPayloads[K]
  ): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;
    // Snapshot the array before iterating so that listeners which call off()
    // during emission do not affect the current dispatch round.
    for (const listener of [...eventListeners]) {
      try {
        listener(payload);
      } catch {
        // Intentionally swallowed: a misbehaving listener must not disrupt
        // the watchdog's internal state or prevent other listeners from firing.
      }
    }
  }
}
