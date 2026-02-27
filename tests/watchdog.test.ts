import { describe, it, expect, vi } from "vitest";
import {
  Severity,
  NodeType,
  SystemStateStatus,
  Watchdog,
  type NodeConfig,
  type WatchdogEventPayloads,
} from "../src/index.js";

const makeConfig = (id: string): NodeConfig => ({
  id,
  type: NodeType.PASSIVE,
  intervalMs: 5000,
  gracePeriodMs: 2000,
  severity: Severity.FATAL,
  recoveryThreshold: 3,
});

describe("Watchdog – Step 2: State Registry", () => {
  describe("registerNode", () => {
    it("should register a valid node configuration without throwing", () => {
      const watchdog = new Watchdog();
      expect(() => watchdog.registerNode(makeConfig("db-primary"))).not.toThrow();
    });

    it("should throw an error when registering a duplicate node id", () => {
      const watchdog = new Watchdog();
      watchdog.registerNode(makeConfig("db-primary"));
      expect(() => watchdog.registerNode(makeConfig("db-primary"))).toThrowError(
        `Node with id "db-primary" is already registered.`
      );
    });

    it("should allow registering multiple nodes with different ids", () => {
      const watchdog = new Watchdog();
      expect(() => {
        watchdog.registerNode(makeConfig("node-a"));
        watchdog.registerNode(makeConfig("node-b"));
      }).not.toThrow();
    });
  });

  describe("getNode", () => {
    it("should retrieve a registered node's configuration by id", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("db-primary");
      watchdog.registerNode(config);
      expect(watchdog.getNode("db-primary")).toEqual(config);
    });

    it("should return undefined for an unregistered node id", () => {
      const watchdog = new Watchdog();
      expect(watchdog.getNode("unknown")).toBeUndefined();
    });
  });
});

describe("Watchdog – Step 3: Event Emitter & Subscriptions", () => {
  describe("on / emit", () => {
    it("should invoke a subscribed listener when the event is emitted", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("db-primary");
      watchdog.registerNode(config);

      const listener = vi.fn();
      const payload: WatchdogEventPayloads["onNodeFailure"] = {
        nodeId: "db-primary",
        config,
      };

      watchdog.on("onNodeFailure", listener);
      watchdog.emit("onNodeFailure", payload);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(payload);
    });

    it("should invoke multiple listeners registered for the same event", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("worker-1");
      watchdog.registerNode(config);

      const listenerA = vi.fn();
      const listenerB = vi.fn();
      const payload: WatchdogEventPayloads["onNodeRecovered"] = {
        nodeId: "worker-1",
        config,
      };

      watchdog.on("onNodeRecovered", listenerA);
      watchdog.on("onNodeRecovered", listenerB);
      watchdog.emit("onNodeRecovered", payload);

      expect(listenerA).toHaveBeenCalledOnce();
      expect(listenerB).toHaveBeenCalledOnce();
    });

    it("should not invoke a listener after it has been removed with off", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("cache");
      watchdog.registerNode(config);

      const listener = vi.fn();
      const payload: WatchdogEventPayloads["onNodeFailure"] = {
        nodeId: "cache",
        config,
      };

      watchdog.on("onNodeFailure", listener);
      watchdog.off("onNodeFailure", listener);
      watchdog.emit("onNodeFailure", payload);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should not throw when emitting an event with no listeners", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("api-gateway");
      watchdog.registerNode(config);

      expect(() =>
        watchdog.emit("onNodeFailure", { nodeId: "api-gateway", config })
      ).not.toThrow();
    });
  });

  describe("onNodeFailure event", () => {
    it("should deliver the correct payload when subscribing to onNodeFailure", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("db-primary");
      watchdog.registerNode(config);

      const received: WatchdogEventPayloads["onNodeFailure"][] = [];
      watchdog.on("onNodeFailure", (payload) => received.push(payload));

      watchdog.emit("onNodeFailure", { nodeId: "db-primary", config });

      expect(received).toHaveLength(1);
      expect(received[0].nodeId).toBe("db-primary");
      expect(received[0].config).toEqual(config);
    });
  });

  describe("onNodeRecovered event", () => {
    it("should deliver the correct payload when subscribing to onNodeRecovered", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("cache-service");
      watchdog.registerNode(config);

      const received: WatchdogEventPayloads["onNodeRecovered"][] = [];
      watchdog.on("onNodeRecovered", (payload) => received.push(payload));

      watchdog.emit("onNodeRecovered", { nodeId: "cache-service", config });

      expect(received).toHaveLength(1);
      expect(received[0].nodeId).toBe("cache-service");
      expect(received[0].config).toEqual(config);
    });
  });

  describe("onSystemStateChange event", () => {
    it("should deliver a SystemState payload when subscribing to onSystemStateChange", () => {
      const watchdog = new Watchdog();

      const received: WatchdogEventPayloads["onSystemStateChange"][] = [];
      watchdog.on("onSystemStateChange", (payload) => received.push(payload));

      const state: WatchdogEventPayloads["onSystemStateChange"] = {
        status: SystemStateStatus.HEALTHY,
        nodes: {},
      };
      watchdog.emit("onSystemStateChange", state);

      expect(received).toHaveLength(1);
      expect(received[0].status).toBe(SystemStateStatus.HEALTHY);
    });
  });
});
