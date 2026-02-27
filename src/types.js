/**
 * Severity level dictating the system-wide impact of a node failure.
 */
export var Severity;
(function (Severity) {
    /** A failure at this level causes a global system failure state. */
    Severity["FATAL"] = "FATAL";
    /** A failure at this level puts the system into a degraded state. */
    Severity["WARNING"] = "WARNING";
    /** A failure at this level is isolated and only logged. */
    Severity["INFO"] = "INFO";
})(Severity || (Severity = {}));
/**
 * Determines how the Watchdog monitors a node.
 */
export var NodeType;
(function (NodeType) {
    /** The node pushes heartbeat signals (pings) to the Watchdog. */
    NodeType["PASSIVE"] = "PASSIVE";
    /** The Watchdog actively polls the node by executing a health-check callback. */
    NodeType["ACTIVE"] = "ACTIVE";
})(NodeType || (NodeType = {}));
/**
 * The current operational state of the overall system.
 */
export var SystemStateStatus;
(function (SystemStateStatus) {
    /** All monitored nodes are healthy. */
    SystemStateStatus["HEALTHY"] = "HEALTHY";
    /** One or more WARNING-severity nodes are failing. */
    SystemStateStatus["DEGRADED"] = "DEGRADED";
    /** One or more FATAL-severity nodes are failing. */
    SystemStateStatus["CRITICAL"] = "CRITICAL";
})(SystemStateStatus || (SystemStateStatus = {}));
