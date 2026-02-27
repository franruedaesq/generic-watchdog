import type {
  NodeConfig,
  WatchdogEventName,
  WatchdogEventPayloads,
} from "./types.js";

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

  /**
   * Registers a node configuration with the Watchdog.
   * @throws {Error} if a node with the same id is already registered.
   */
  registerNode(config: NodeConfig): void {
    if (this.nodes.has(config.id)) {
      throw new Error(`Node with id "${config.id}" is already registered.`);
    }
    this.nodes.set(config.id, config);
  }

  /**
   * Retrieves the configuration of a registered node by its id.
   * @returns The NodeConfig, or undefined if not found.
   */
  getNode(id: string): NodeConfig | undefined {
    return this.nodes.get(id);
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
   */
  emit<K extends WatchdogEventName>(
    event: K,
    payload: WatchdogEventPayloads[K]
  ): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;
    for (const listener of eventListeners) {
      listener(payload);
    }
  }
}
