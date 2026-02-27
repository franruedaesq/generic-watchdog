import { describe, it, expect } from "vitest";
import {
  Severity,
  NodeType,
  SystemStateStatus,
  type NodeConfig,
  type NodeStatus,
  type SystemState,
} from "../src/index.js";

describe("generic-watchdog – core types", () => {
  it("should have the test runner working", () => {
    expect(true).toBe(true);
  });

  describe("Severity enum", () => {
    it("should define FATAL, WARNING, and INFO values", () => {
      expect(Severity.FATAL).toBe("FATAL");
      expect(Severity.WARNING).toBe("WARNING");
      expect(Severity.INFO).toBe("INFO");
    });
  });

  describe("NodeType enum", () => {
    it("should define PASSIVE and ACTIVE values", () => {
      expect(NodeType.PASSIVE).toBe("PASSIVE");
      expect(NodeType.ACTIVE).toBe("ACTIVE");
    });
  });

  describe("SystemStateStatus enum", () => {
    it("should define HEALTHY, DEGRADED, and CRITICAL values", () => {
      expect(SystemStateStatus.HEALTHY).toBe("HEALTHY");
      expect(SystemStateStatus.DEGRADED).toBe("DEGRADED");
      expect(SystemStateStatus.CRITICAL).toBe("CRITICAL");
    });
  });

  describe("NodeConfig interface", () => {
    it("should accept a valid PASSIVE node configuration", () => {
      const config: NodeConfig = {
        id: "db-primary",
        type: NodeType.PASSIVE,
        intervalMs: 5000,
        gracePeriodMs: 2000,
        severity: Severity.FATAL,
        recoveryThreshold: 3,
      };

      expect(config.id).toBe("db-primary");
      expect(config.type).toBe(NodeType.PASSIVE);
      expect(config.intervalMs).toBe(5000);
      expect(config.gracePeriodMs).toBe(2000);
      expect(config.severity).toBe(Severity.FATAL);
      expect(config.recoveryThreshold).toBe(3);
      expect(config.healthCheckFn).toBeUndefined();
    });

    it("should accept a valid ACTIVE node configuration with a healthCheckFn", () => {
      const healthCheckFn = async (): Promise<boolean> => true;

      const config: NodeConfig = {
        id: "cache-service",
        type: NodeType.ACTIVE,
        intervalMs: 10000,
        gracePeriodMs: 3000,
        severity: Severity.WARNING,
        recoveryThreshold: 2,
        healthCheckFn,
      };

      expect(config.id).toBe("cache-service");
      expect(config.type).toBe(NodeType.ACTIVE);
      expect(config.healthCheckFn).toBe(healthCheckFn);
    });
  });

  describe("NodeStatus interface", () => {
    it("should represent a healthy node status snapshot", () => {
      const status: NodeStatus = {
        id: "db-primary",
        healthy: true,
        lastSeen: Date.now(),
        consecutiveSuccesses: 5,
        consecutiveFailures: 0,
      };

      expect(status.id).toBe("db-primary");
      expect(status.healthy).toBe(true);
      expect(status.consecutiveSuccesses).toBe(5);
      expect(status.consecutiveFailures).toBe(0);
    });

    it("should represent an unhealthy node status with null lastSeen", () => {
      const status: NodeStatus = {
        id: "worker-1",
        healthy: false,
        lastSeen: null,
        consecutiveSuccesses: 0,
        consecutiveFailures: 4,
      };

      expect(status.healthy).toBe(false);
      expect(status.lastSeen).toBeNull();
      expect(status.consecutiveFailures).toBe(4);
    });
  });

  describe("SystemState interface", () => {
    it("should represent a healthy system state with node snapshots", () => {
      const nodeStatus: NodeStatus = {
        id: "api-gateway",
        healthy: true,
        lastSeen: Date.now(),
        consecutiveSuccesses: 10,
        consecutiveFailures: 0,
      };

      const state: SystemState = {
        status: SystemStateStatus.HEALTHY,
        nodes: { "api-gateway": nodeStatus },
      };

      expect(state.status).toBe(SystemStateStatus.HEALTHY);
      expect(state.nodes["api-gateway"]).toEqual(nodeStatus);
    });

    it("should represent a system in CRITICAL state", () => {
      const state: SystemState = {
        status: SystemStateStatus.CRITICAL,
        nodes: {
          "db-primary": {
            id: "db-primary",
            healthy: false,
            lastSeen: null,
            consecutiveSuccesses: 0,
            consecutiveFailures: 1,
          },
        },
      };

      expect(state.status).toBe(SystemStateStatus.CRITICAL);
      expect(state.nodes["db-primary"].healthy).toBe(false);
    });
  });
});
