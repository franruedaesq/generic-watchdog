/**
 * Severity level dictating the system-wide impact of a node failure.
 */
export enum Severity {
  /** A failure at this level causes a global system failure state. */
  FATAL = "FATAL",
  /** A failure at this level puts the system into a degraded state. */
  WARNING = "WARNING",
  /** A failure at this level is isolated and only logged. */
  INFO = "INFO",
}

/**
 * Determines how the Watchdog monitors a node.
 */
export enum NodeType {
  /** The node pushes heartbeat signals (pings) to the Watchdog. */
  PASSIVE = "PASSIVE",
  /** The Watchdog actively polls the node by executing a health-check callback. */
  ACTIVE = "ACTIVE",
}

/**
 * The current operational state of the overall system.
 */
export enum SystemStateStatus {
  /** All monitored nodes are healthy. */
  HEALTHY = "HEALTHY",
  /** One or more WARNING-severity nodes are failing. */
  DEGRADED = "DEGRADED",
  /** One or more FATAL-severity nodes are failing. */
  FAILURE = "FAILURE",
}

/**
 * Configuration object supplied when registering a node with the Watchdog.
 */
export interface NodeConfig {
  /** Unique identifier for the monitored service. */
  id: string;
  /** Dictates if the Watchdog listens for pings (PASSIVE) or actively polls (ACTIVE). */
  type: NodeType;
  /** Frequency of checks or expected heartbeat interval in milliseconds. */
  intervalMs: number;
  /** Time allowed past the interval before declaring a timeout, in milliseconds. */
  gracePeriodMs: number;
  /** Dictates the system-wide reaction upon failure. */
  severity: Severity;
  /** Consecutive successful checks required to clear a failure state. */
  recoveryThreshold: number;
  /** The async function to execute when type is ACTIVE. */
  healthCheckFn?: () => Promise<boolean>;
}

/**
 * A read-only snapshot of the current status of a single monitored node.
 */
export interface NodeStatus {
  /** The node's unique identifier. */
  readonly id: string;
  /** Whether the node is currently considered healthy. */
  readonly healthy: boolean;
  /** Timestamp (ms since epoch) of the last successful ping or health-check. */
  readonly lastSeen: number | null;
  /** Number of consecutive successful checks since the last failure. */
  readonly consecutiveSuccesses: number;
  /** Number of consecutive failed checks. */
  readonly consecutiveFailures: number;
}

/**
 * A read-only snapshot of the overall system state managed by the Watchdog.
 */
export interface SystemState {
  /** The overall operational status of the system. */
  readonly status: SystemStateStatus;
  /** A map of node IDs to their individual status snapshots. */
  readonly nodes: Readonly<Record<string, NodeStatus>>;
}
