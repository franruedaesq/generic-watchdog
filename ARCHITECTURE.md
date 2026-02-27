# generic-watchdog — Architecture & Documentation

## Context & Mission

**Project:** generic-watchdog

**Mission:** Create a professional, zero-dependency TypeScript library for monitoring the operational state of disparate system nodes (sockets, workers, databases) through strict contracts.

**Core Philosophy:**

- **Total Ignorance:** The library parses no business logic. It relies purely on timestamps, booleans, and generic payloads.
- **Asynchronous & Non-Blocking:** The monitoring loop must never hang or block the main thread.
- **Hierarchical Importance:** Node failures impact the global system state based on defined severity levels.

---

## Capabilities

### Passive Liveness (Heartbeats)
Nodes push "ping" signals to the Watchdog. The Watchdog evaluates if `current_time - last_ping > TTL` to determine whether a node has gone silent.

### Active Readiness (Polling)
The Watchdog actively executes a registered asynchronous callback function to check node health, adhering to strict timeout thresholds.

### Severity Levels
Failures are classified into:
- **FATAL** — global system failure state
- **WARNING** — degraded global state
- **INFO** — isolated failure, log only

### Hysteresis (Flap Mitigation)
Nodes must demonstrate stability by passing a configured number of consecutive health checks (`recoveryThreshold`) before being reintroduced to the healthy pool.

### Event-Driven Lifecycle
Built-in Publish/Subscribe (Pub/Sub) mechanics to broadcast state changes:
- `onNodeFailure`
- `onNodeRecovered`
- `onSystemStateChange`

---

## Configuration Schema

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier for the monitored service. |
| `type` | `PASSIVE` \| `ACTIVE` | Dictates if the Watchdog listens for pings or actively polls. |
| `intervalMs` | `number` | Frequency of checks or expected heartbeats in milliseconds. |
| `gracePeriodMs` | `number` | Time allowed past the interval before declaring a timeout. |
| `severity` | `FATAL` \| `WARNING` \| `INFO` | Dictates system-wide reaction upon failure. |
| `recoveryThreshold` | `number` | Consecutive successful checks required to clear a failure state. |
| `healthCheckFn` | `() => Promise<boolean>` (Optional) | The async function to execute if type is `ACTIVE`. |

---

## Architecture & Developer Experience (DX)

### Language
Strict TypeScript — all types are explicitly declared; `strict: true` is enforced in `tsconfig.json`.

### Testing
[Vitest](https://vitest.dev/) is used as the test runner following a TDD (Test-Driven Development) approach:
- Write the test first
- Watch it fail
- Write the minimal implementation to pass
- Proceed to the next step

### Module System
The library is built for both **ESM** and **CommonJS** to ensure broad npm compatibility:

```
dist/
  esm/    ← ES Modules (import/export)
  cjs/    ← CommonJS (require/module.exports)
  types/  ← TypeScript declarations (.d.ts)
```

### Core Pattern
The Watchdog extends a lightweight custom Pub/Sub implementation (to maintain **zero external dependencies**) to handle lifecycle hooks cleanly.

### Immutability
State changes are handled predictably. The Watchdog exposes a **read-only snapshot** of the current global state and individual node statuses via the `SystemState` and `NodeStatus` interfaces.

### Zero Dependencies
The library ships with **no runtime dependencies**. All dev tooling (`typescript`, `vitest`) is listed under `devDependencies` only.

---

## Core Domain Types

### Enums

```typescript
enum Severity {
  FATAL   // Global system failure
  WARNING // Degraded system state
  INFO    // Isolated failure, log only
}

enum NodeType {
  PASSIVE // Node pushes heartbeat signals
  ACTIVE  // Watchdog actively polls the node
}

enum SystemStateStatus {
  HEALTHY  // All monitored nodes are healthy
  DEGRADED // One or more WARNING nodes are failing
  FAILURE  // One or more FATAL nodes are failing
}
```

### Interfaces

```typescript
interface NodeConfig {
  id: string;
  type: NodeType;
  intervalMs: number;
  gracePeriodMs: number;
  severity: Severity;
  recoveryThreshold: number;
  healthCheckFn?: () => Promise<boolean>;
}

interface NodeStatus {
  readonly id: string;
  readonly healthy: boolean;
  readonly lastSeen: number | null;
  readonly consecutiveSuccesses: number;
  readonly consecutiveFailures: number;
}

interface SystemState {
  readonly status: SystemStateStatus;
  readonly nodes: Readonly<Record<string, NodeStatus>>;
}
```

---

## Project Structure

```
generic-watchdog/
├── src/
│   ├── types.ts        ← Core domain types, enums, and interfaces
│   └── index.ts        ← Public API entry point
├── tests/
│   └── types.test.ts   ← TDD tests for core types
├── dist/               ← Build output (generated, not committed)
│   ├── esm/
│   ├── cjs/
│   └── types/
├── tsconfig.json       ← Base TypeScript config (for IDE + tests)
├── tsconfig.esm.json   ← ESM build config
├── tsconfig.cjs.json   ← CommonJS build config
├── tsconfig.types.json ← Declaration-only build config
├── package.json
├── ARCHITECTURE.md     ← This file
└── README.md
```
