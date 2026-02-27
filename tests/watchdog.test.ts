import { describe, it, expect, vi, afterEach } from "vitest";
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

const makePassiveConfig = (id: string): NodeConfig => ({
  id,
  type: NodeType.PASSIVE,
  intervalMs: 1000,
  gracePeriodMs: 500,
  severity: Severity.FATAL,
  recoveryThreshold: 3,
});

const makeActiveConfig = (
  id: string,
  healthCheckFn: () => Promise<boolean>
): NodeConfig => ({
  id,
  type: NodeType.ACTIVE,
  intervalMs: 1000,
  gracePeriodMs: 500,
  severity: Severity.FATAL,
  recoveryThreshold: 3,
  healthCheckFn,
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

describe("Watchdog – Step 4: Passive Monitoring (Heartbeats)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("ping", () => {
    it("should update lastSeen when ping is called", () => {
      const watchdog = new Watchdog();
      watchdog.registerNode(makePassiveConfig("heartbeat-service"));

      const before = Date.now();
      watchdog.ping("heartbeat-service");
      const status = watchdog.getNodeStatus("heartbeat-service");

      expect(status?.lastSeen).toBeGreaterThanOrEqual(before);
      expect(status?.lastSeen).toBeLessThanOrEqual(Date.now());
    });

    it("should increment consecutiveSuccesses on each ping for a healthy node", () => {
      const watchdog = new Watchdog();
      watchdog.registerNode(makePassiveConfig("heartbeat-service"));

      watchdog.ping("heartbeat-service");
      watchdog.ping("heartbeat-service");
      const status = watchdog.getNodeStatus("heartbeat-service");

      expect(status?.consecutiveSuccesses).toBe(2);
    });

    it("should throw when pinging an unregistered node", () => {
      const watchdog = new Watchdog();
      expect(() => watchdog.ping("unknown-node")).toThrowError(
        `Node with id "unknown-node" is not registered.`
      );
    });
  });

  describe("TTL expiry", () => {
    it("should mark node UNHEALTHY and emit onNodeFailure when TTL expires", () => {
      vi.useFakeTimers();
      const watchdog = new Watchdog();
      const config = makePassiveConfig("heartbeat-service");
      watchdog.registerNode(config);

      const listener = vi.fn();
      watchdog.on("onNodeFailure", listener);

      watchdog.ping("heartbeat-service");

      vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({
        nodeId: "heartbeat-service",
        config,
      });

      const status = watchdog.getNodeStatus("heartbeat-service");
      expect(status?.healthy).toBe(false);

      watchdog.stop();
    });

    it("should not emit onNodeFailure if a ping resets the TTL before expiry", () => {
      vi.useFakeTimers();
      const watchdog = new Watchdog();
      const config = makePassiveConfig("heartbeat-service");
      watchdog.registerNode(config);

      const listener = vi.fn();
      watchdog.on("onNodeFailure", listener);

      watchdog.ping("heartbeat-service");
      vi.advanceTimersByTime(config.intervalMs);
      watchdog.ping("heartbeat-service");
      vi.advanceTimersByTime(config.intervalMs);

      expect(listener).not.toHaveBeenCalled();

      watchdog.stop();
    });

    it("should emit onSystemStateChange when a node becomes UNHEALTHY", () => {
      vi.useFakeTimers();
      const watchdog = new Watchdog();
      const config = makePassiveConfig("heartbeat-service");
      watchdog.registerNode(config);

      const systemListener = vi.fn();
      watchdog.on("onSystemStateChange", systemListener);

      watchdog.ping("heartbeat-service");
      vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

      expect(systemListener).toHaveBeenCalledOnce();
      expect(systemListener).toHaveBeenCalledWith(
        expect.objectContaining({ status: SystemStateStatus.FAILURE })
      );

      watchdog.stop();
    });
  });
});

describe("Watchdog – Step 5: Active Monitoring (Polling)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should call healthCheckFn at the specified intervalMs", async () => {
    vi.useFakeTimers();
    const healthCheckFn = vi.fn().mockResolvedValue(true);
    const config = makeActiveConfig("api-service", healthCheckFn);
    const watchdog = new Watchdog();
    watchdog.registerNode(config);
    watchdog.start();

    await vi.advanceTimersByTimeAsync(config.intervalMs + 1);

    expect(healthCheckFn).toHaveBeenCalledOnce();

    watchdog.stop();
  });

  it("should call healthCheckFn again at the next interval", async () => {
    vi.useFakeTimers();
    const healthCheckFn = vi.fn().mockResolvedValue(true);
    const config = makeActiveConfig("api-service", healthCheckFn);
    const watchdog = new Watchdog();
    watchdog.registerNode(config);
    watchdog.start();

    await vi.advanceTimersByTimeAsync(config.intervalMs * 3 + 1);

    expect(healthCheckFn).toHaveBeenCalledTimes(3);

    watchdog.stop();
  });

  it("should mark node UNHEALTHY and emit onNodeFailure when healthCheckFn times out", async () => {
    vi.useFakeTimers();
    const healthCheckFn = vi
      .fn()
      .mockReturnValue(new Promise<boolean>(() => {}));
    const config = makeActiveConfig("slow-service", healthCheckFn);
    const watchdog = new Watchdog();
    watchdog.registerNode(config);

    const listener = vi.fn();
    watchdog.on("onNodeFailure", listener);

    watchdog.start();

    await vi.advanceTimersByTimeAsync(
      config.intervalMs + config.gracePeriodMs + 1
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      nodeId: "slow-service",
      config,
    });

    const status = watchdog.getNodeStatus("slow-service");
    expect(status?.healthy).toBe(false);

    watchdog.stop();
  });

  it("should mark node UNHEALTHY and emit onNodeFailure when healthCheckFn throws", async () => {
    vi.useFakeTimers();
    const healthCheckFn = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"));
    const config = makeActiveConfig("failing-service", healthCheckFn);
    const watchdog = new Watchdog();
    watchdog.registerNode(config);

    const listener = vi.fn();
    watchdog.on("onNodeFailure", listener);

    watchdog.start();

    await vi.advanceTimersByTimeAsync(config.intervalMs + 1);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      nodeId: "failing-service",
      config,
    });

    watchdog.stop();
  });

  it("should update lastSeen when healthCheckFn returns true", async () => {
    vi.useFakeTimers();
    const healthCheckFn = vi.fn().mockResolvedValue(true);
    const config = makeActiveConfig("healthy-service", healthCheckFn);
    const watchdog = new Watchdog();
    watchdog.registerNode(config);
    watchdog.start();

    await vi.advanceTimersByTimeAsync(config.intervalMs + 1);

    const status = watchdog.getNodeStatus("healthy-service");
    expect(status?.lastSeen).not.toBeNull();
    expect(status?.healthy).toBe(true);

    watchdog.stop();
  });

  it("should not call healthCheckFn after stop()", async () => {
    vi.useFakeTimers();
    const healthCheckFn = vi.fn().mockResolvedValue(true);
    const config = makeActiveConfig("api-service", healthCheckFn);
    const watchdog = new Watchdog();
    watchdog.registerNode(config);
    watchdog.start();

    await vi.advanceTimersByTimeAsync(config.intervalMs + 1);
    expect(healthCheckFn).toHaveBeenCalledOnce();

    watchdog.stop();

    await vi.advanceTimersByTimeAsync(config.intervalMs * 3);
    expect(healthCheckFn).toHaveBeenCalledOnce();
  });
});
