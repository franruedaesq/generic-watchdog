# generic-watchdog

A professional, zero-dependency TypeScript library for monitoring the operational state of disparate system nodes (sockets, workers, databases) through strict contracts.

## Features

- **Passive monitoring** — nodes push heartbeat pings; the watchdog declares failure when the TTL expires
- **Active monitoring** — the watchdog polls nodes on a configurable interval using an async health-check callback
- **Severity levels** — `FATAL`, `WARNING`, and `INFO` control the system-wide reaction to each node's failure
- **Hysteresis / flap mitigation** — a configurable `recoveryThreshold` of consecutive successes is required before a node is declared healthy again
- **Event-driven lifecycle** — built-in Pub/Sub emitter: `onNodeFailure`, `onNodeRecovered`, `onSystemStateChange`, `onSystemCritical`
- **Dual ESM + CJS build** — works with `import` and `require`; ships full TypeScript declarations
- **Zero runtime dependencies**

## Installation

```sh
npm install generic-watchdog
```

## Quick Start

```typescript
import { Watchdog, NodeType, Severity } from 'generic-watchdog';

const watchdog = new Watchdog();

// Register a passive node (it pushes pings)
watchdog.registerNode({
  id: 'db-primary',
  type: NodeType.PASSIVE,
  intervalMs: 5000,      // expected heartbeat every 5 s
  gracePeriodMs: 2000,   // 2 s grace period before declaring failure
  severity: Severity.FATAL,
  recoveryThreshold: 3,  // 3 consecutive pings to recover
});

// Register an active node (watchdog polls it)
watchdog.registerNode({
  id: 'cache',
  type: NodeType.ACTIVE,
  intervalMs: 10000,
  gracePeriodMs: 3000,
  severity: Severity.WARNING,
  recoveryThreshold: 2,
  healthCheckFn: async () => {
    // return true = healthy, false or throw = unhealthy
    const ok = await pingRedis();
    return ok;
  },
});

// Subscribe to events
watchdog.on('onNodeFailure', ({ nodeId, config }) => {
  console.error(`Node "${nodeId}" (${config.severity}) has failed`);
});

watchdog.on('onSystemCritical', (state) => {
  console.error('System is CRITICAL', state);
});

// Start background monitoring
watchdog.start();

// Send a heartbeat from a passive node
watchdog.ping('db-primary');

// Read current state at any time
const state = watchdog.getSystemState();
console.log(state.status); // "HEALTHY" | "DEGRADED" | "CRITICAL"

// Stop all timers when shutting down
watchdog.stop();
```

## API

### `new Watchdog()`

Creates a new Watchdog instance.

### `registerNode(config: NodeConfig): void`

Registers a node. Throws if a node with the same `id` is already registered.

### `unregisterNode(id: string): void`

Unregisters a node and clears all its timers. Throws if the node is not found.

### `getNode(id: string): NodeConfig | undefined`

Returns the configuration of a registered node, or `undefined`.

### `getNodeStatus(id: string): NodeStatus | undefined`

Returns a read-only status snapshot of a node, or `undefined`.

### `getSystemState(): SystemState`

Returns a snapshot of the overall system state, including all node statuses.

### `ping(nodeId: string): void`

Records a heartbeat from a **PASSIVE** node and resets its TTL timer. Throws if the node is not registered.

### `start(): void`

Starts the background monitoring loop. ACTIVE nodes begin polling; PASSIVE nodes without a prior ping start their TTL countdown. Idempotent — calling `start()` on an already-started watchdog is a no-op.

### `stop(): void`

Stops all background timers and intervals. The watchdog can be restarted by calling `start()` again.

### `on(event, listener): void`

Subscribes to a watchdog event.

### `off(event, listener): void`

Unsubscribes from a watchdog event.

### `emit(event, payload): void`

Emits a watchdog event to all registered listeners.

## Configuration (`NodeConfig`)

| Property | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✔ | Unique identifier for the monitored service. |
| `type` | `NodeType` | ✔ | `PASSIVE` (heartbeat) or `ACTIVE` (polling). |
| `intervalMs` | `number` | ✔ | Expected heartbeat interval or polling frequency in ms. |
| `gracePeriodMs` | `number` | ✔ | Extra time allowed past `intervalMs` before declaring failure. |
| `severity` | `Severity` | ✔ | System-wide reaction upon failure: `FATAL`, `WARNING`, or `INFO`. |
| `recoveryThreshold` | `number` | ✔ | Consecutive successes required to transition back to healthy. |
| `healthCheckFn` | `() => Promise<boolean>` | ✗ | Required when `type` is `ACTIVE`. Returns `true` = healthy. |

## Events (`WatchdogEventName`)

| Event | Payload | Description |
|---|---|---|
| `onNodeFailure` | `{ nodeId, config }` | Fired when a node transitions to unhealthy. |
| `onNodeRecovered` | `{ nodeId, config }` | Fired when a node transitions back to healthy. |
| `onSystemStateChange` | `SystemState` | Fired on every system state change. |
| `onSystemCritical` | `SystemState` | Fired when the system enters `CRITICAL` state. |

## Severity & System State

| Node Severity | Effect on system state when failing |
|---|---|
| `FATAL` | `CRITICAL` |
| `WARNING` | `DEGRADED` |
| `INFO` | `HEALTHY` (isolated failure) |

## License

[MIT](./LICENSE)

