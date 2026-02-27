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
  healthCheckFn: (signal: AbortSignal) => Promise<boolean>
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

    it("should throw when id is an empty string", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({ ...makeConfig("valid"), id: "" })
      ).toThrowError("Node id must be a non-empty string.");
    });

    it("should throw when id is a whitespace-only string", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({ ...makeConfig("valid"), id: "   " })
      ).toThrowError("Node id must be a non-empty string.");
    });

    it("should throw when intervalMs is zero", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({ ...makeConfig("node"), intervalMs: 0 })
      ).toThrowError("Node intervalMs must be a positive number.");
    });

    it("should throw when intervalMs is negative", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({ ...makeConfig("node"), intervalMs: -100 })
      ).toThrowError("Node intervalMs must be a positive number.");
    });

    it("should throw when gracePeriodMs is negative", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({ ...makeConfig("node"), gracePeriodMs: -1 })
      ).toThrowError("Node gracePeriodMs must be a non-negative number.");
    });

    it("should allow gracePeriodMs of zero", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({ ...makeConfig("node"), gracePeriodMs: 0 })
      ).not.toThrow();
    });

    it("should throw when recoveryThreshold is zero", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({ ...makeConfig("node"), recoveryThreshold: 0 })
      ).toThrowError("Node recoveryThreshold must be a positive integer.");
    });

    it("should throw when recoveryThreshold is a non-integer", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({ ...makeConfig("node"), recoveryThreshold: 1.5 })
      ).toThrowError("Node recoveryThreshold must be a positive integer.");
    });

    it("should throw when an ACTIVE node is registered without a healthCheckFn", () => {
      const watchdog = new Watchdog();
      expect(() =>
        watchdog.registerNode({
          id: "active-no-fn",
          type: NodeType.ACTIVE,
          intervalMs: 1000,
          gracePeriodMs: 500,
          severity: Severity.FATAL,
          recoveryThreshold: 1,
        })
      ).toThrowError(
        `Node "active-no-fn" is type ACTIVE but no healthCheckFn was provided.`
      );
    });

    it("should not allow external mutation of a registered config to affect internal state", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("db-primary");
      watchdog.registerNode(config);
      const expectedIntervalMs = makeConfig("db-primary").intervalMs;
      // Attempt to mutate the original config after registration.
      (config as unknown as Record<string, unknown>).intervalMs = 99999;
      expect(watchdog.getNode("db-primary")?.intervalMs).toBe(expectedIntervalMs);
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

    it("should invoke subsequent listeners even if a previous listener throws", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("db-primary");
      watchdog.registerNode(config);

      const throwingListener = vi.fn().mockImplementation(() => {
        throw new Error("listener error");
      });
      const safeListener = vi.fn();

      watchdog.on("onNodeFailure", throwingListener);
      watchdog.on("onNodeFailure", safeListener);
      watchdog.emit("onNodeFailure", { nodeId: "db-primary", config });

      expect(throwingListener).toHaveBeenCalledOnce();
      expect(safeListener).toHaveBeenCalledOnce();
    });

    it("should not throw when a listener throws during emit", () => {
      const watchdog = new Watchdog();
      const config = makeConfig("db-primary");
      watchdog.registerNode(config);

      watchdog.on("onNodeFailure", () => {
        throw new Error("listener error");
      });

      expect(() =>
        watchdog.emit("onNodeFailure", { nodeId: "db-primary", config })
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

    it("should throw when pinging an ACTIVE node", () => {
      const watchdog = new Watchdog();
      watchdog.registerNode(makeActiveConfig("active-node", async () => true));
      expect(() => watchdog.ping("active-node")).toThrowError(
        `Node "active-node" is type ACTIVE; ping() is only valid for PASSIVE nodes.`
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
        expect.objectContaining({ status: SystemStateStatus.CRITICAL })
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

  it("should pass an AbortSignal to healthCheckFn", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const healthCheckFn = vi.fn().mockImplementation((signal: AbortSignal) => {
      receivedSignal = signal;
      return Promise.resolve(true);
    });
    const config = makeActiveConfig("signal-service", healthCheckFn);
    const watchdog = new Watchdog();
    watchdog.registerNode(config);
    watchdog.start();

    await vi.advanceTimersByTimeAsync(config.intervalMs + 1);

    expect(healthCheckFn).toHaveBeenCalledOnce();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);

    watchdog.stop();
  });

  it("should abort the AbortSignal when healthCheckFn times out", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const healthCheckFn = vi.fn().mockImplementation((signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<boolean>(() => {});
    });
    const config = makeActiveConfig("timeout-signal-service", healthCheckFn);
    const watchdog = new Watchdog();
    watchdog.registerNode(config);
    watchdog.start();

    await vi.advanceTimersByTimeAsync(config.intervalMs + config.gracePeriodMs + 1);

    expect(receivedSignal?.aborted).toBe(true);

    watchdog.stop();
  });
});

describe("Watchdog – Step 6: Hysteresis (Flap Mitigation)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("PASSIVE node recovery threshold", () => {
    it("should remain UNHEALTHY if consecutive successes are below recoveryThreshold", () => {
      vi.useFakeTimers();
      const watchdog = new Watchdog();
      const config = makePassiveConfig("flap-service");
      watchdog.registerNode(config);

      const recoveryListener = vi.fn();
      watchdog.on("onNodeRecovered", recoveryListener);

      // Make the node UNHEALTHY via TTL expiry
      watchdog.ping("flap-service");
      vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);
      expect(watchdog.getNodeStatus("flap-service")?.healthy).toBe(false);

      // Ping fewer times than recoveryThreshold (3)
      watchdog.ping("flap-service");
      watchdog.ping("flap-service");

      const status = watchdog.getNodeStatus("flap-service");
      expect(status?.healthy).toBe(false);
      expect(status?.consecutiveSuccesses).toBe(2);
      expect(recoveryListener).not.toHaveBeenCalled();

      watchdog.stop();
    });

    it("should transition to HEALTHY and emit onNodeRecovered when pings meet recoveryThreshold", () => {
      vi.useFakeTimers();
      const watchdog = new Watchdog();
      const config = makePassiveConfig("flap-service");
      watchdog.registerNode(config);

      const recoveryListener = vi.fn();
      watchdog.on("onNodeRecovered", recoveryListener);

      // Make the node UNHEALTHY via TTL expiry
      watchdog.ping("flap-service");
      vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);
      expect(watchdog.getNodeStatus("flap-service")?.healthy).toBe(false);

      // Ping exactly recoveryThreshold (3) times
      watchdog.ping("flap-service");
      watchdog.ping("flap-service");
      watchdog.ping("flap-service");

      const status = watchdog.getNodeStatus("flap-service");
      expect(status?.healthy).toBe(true);
      expect(recoveryListener).toHaveBeenCalledOnce();
      expect(recoveryListener).toHaveBeenCalledWith({ nodeId: "flap-service", config });

      watchdog.stop();
    });

    it("should reset consecutiveSuccesses to zero when TTL expires again", () => {
      vi.useFakeTimers();
      const watchdog = new Watchdog();
      const config = makePassiveConfig("flap-service");
      watchdog.registerNode(config);

      // Make the node UNHEALTHY via TTL expiry
      watchdog.ping("flap-service");
      vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

      // Ping twice (below recoveryThreshold)
      watchdog.ping("flap-service");
      watchdog.ping("flap-service");
      expect(watchdog.getNodeStatus("flap-service")?.consecutiveSuccesses).toBe(2);

      // Let TTL expire again – should reset consecutiveSuccesses
      vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

      expect(watchdog.getNodeStatus("flap-service")?.consecutiveSuccesses).toBe(0);
      expect(watchdog.getNodeStatus("flap-service")?.healthy).toBe(false);

      watchdog.stop();
    });
  });

  describe("ACTIVE node recovery threshold", () => {
    it("should remain UNHEALTHY if consecutive successful polls are below recoveryThreshold", async () => {
      vi.useFakeTimers();
      const healthCheckFn = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const config = makeActiveConfig("flap-active", healthCheckFn);
      const watchdog = new Watchdog();
      watchdog.registerNode(config);

      const recoveryListener = vi.fn();
      watchdog.on("onNodeRecovered", recoveryListener);

      watchdog.start();

      // First poll fails → UNHEALTHY
      await vi.advanceTimersByTimeAsync(config.intervalMs + 1);
      expect(watchdog.getNodeStatus("flap-active")?.healthy).toBe(false);

      // Next two polls succeed (below recoveryThreshold of 3)
      await vi.advanceTimersByTimeAsync(config.intervalMs);
      await vi.advanceTimersByTimeAsync(config.intervalMs);

      const status = watchdog.getNodeStatus("flap-active");
      expect(status?.healthy).toBe(false);
      expect(status?.consecutiveSuccesses).toBe(2);
      expect(recoveryListener).not.toHaveBeenCalled();

      watchdog.stop();
    });

    it("should transition to HEALTHY and emit onNodeRecovered when polls meet recoveryThreshold", async () => {
      vi.useFakeTimers();
      const healthCheckFn = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const config = makeActiveConfig("flap-active", healthCheckFn);
      const watchdog = new Watchdog();
      watchdog.registerNode(config);

      const recoveryListener = vi.fn();
      watchdog.on("onNodeRecovered", recoveryListener);

      watchdog.start();

      // First poll fails → UNHEALTHY
      await vi.advanceTimersByTimeAsync(config.intervalMs + 1);
      expect(watchdog.getNodeStatus("flap-active")?.healthy).toBe(false);

      // Three consecutive successful polls (meets recoveryThreshold of 3)
      await vi.advanceTimersByTimeAsync(config.intervalMs);
      await vi.advanceTimersByTimeAsync(config.intervalMs);
      await vi.advanceTimersByTimeAsync(config.intervalMs);

      const status = watchdog.getNodeStatus("flap-active");
      expect(status?.healthy).toBe(true);
      expect(recoveryListener).toHaveBeenCalledOnce();
      expect(recoveryListener).toHaveBeenCalledWith({ nodeId: "flap-active", config });

      watchdog.stop();
    });

    it("should reset consecutiveSuccesses to zero when a poll fails", async () => {
      vi.useFakeTimers();
      const healthCheckFn = vi
        .fn()
        .mockResolvedValueOnce(false) // first poll → UNHEALTHY
        .mockResolvedValueOnce(true)  // second poll → success 1
        .mockResolvedValueOnce(true)  // third poll → success 2
        .mockResolvedValueOnce(false) // fourth poll → failure, resets counter
        .mockResolvedValue(true);
      const config = makeActiveConfig("flap-active", healthCheckFn);
      const watchdog = new Watchdog();
      watchdog.registerNode(config);

      watchdog.start();

      // First poll fails → UNHEALTHY
      await vi.advanceTimersByTimeAsync(config.intervalMs + 1);
      expect(watchdog.getNodeStatus("flap-active")?.healthy).toBe(false);

      // Two successful polls
      await vi.advanceTimersByTimeAsync(config.intervalMs);
      await vi.advanceTimersByTimeAsync(config.intervalMs);
      expect(watchdog.getNodeStatus("flap-active")?.consecutiveSuccesses).toBe(2);

      // Fourth poll fails → resets consecutiveSuccesses
      await vi.advanceTimersByTimeAsync(config.intervalMs);
      expect(watchdog.getNodeStatus("flap-active")?.consecutiveSuccesses).toBe(0);

      watchdog.stop();
    });
  });
});

describe("Watchdog – Step 8: Cleanup & Lifecycle Management", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("stop()", () => {
    it("should prevent further PASSIVE TTL callbacks after stop()", () => {
      vi.useFakeTimers();
      const watchdog = new Watchdog();
      const config = makePassiveConfig("passive-node");
      watchdog.registerNode(config);

      const listener = vi.fn();
      watchdog.on("onNodeFailure", listener);

      watchdog.ping("passive-node");
      watchdog.stop();

      vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should prevent further ACTIVE polling after stop()", async () => {
      vi.useFakeTimers();
      const healthCheckFn = vi.fn().mockResolvedValue(true);
      const config = makeActiveConfig("active-node", healthCheckFn);
      const watchdog = new Watchdog();
      watchdog.registerNode(config);
      watchdog.start();

      await vi.advanceTimersByTimeAsync(config.intervalMs + 1);
      expect(healthCheckFn).toHaveBeenCalledOnce();

      watchdog.stop();

      await vi.advanceTimersByTimeAsync(config.intervalMs * 5);
      expect(healthCheckFn).toHaveBeenCalledOnce();
    });

    it("should allow restart after stop()", async () => {
      vi.useFakeTimers();
      const healthCheckFn = vi.fn().mockResolvedValue(true);
      const config = makeActiveConfig("active-node", healthCheckFn);
      const watchdog = new Watchdog();
      watchdog.registerNode(config);
      watchdog.start();

      await vi.advanceTimersByTimeAsync(config.intervalMs + 1);
      expect(healthCheckFn).toHaveBeenCalledOnce();

      watchdog.stop();
      watchdog.start();

      await vi.advanceTimersByTimeAsync(config.intervalMs + 1);
      expect(healthCheckFn).toHaveBeenCalledTimes(2);

      watchdog.stop();
    });
  });

  describe("unregisterNode()", () => {
    it("should throw when unregistering a node that is not registered", () => {
      const watchdog = new Watchdog();
      expect(() => watchdog.unregisterNode("unknown-node")).toThrowError(
        `Node with id "unknown-node" is not registered.`
      );
    });

    it("should remove the node so getNode returns undefined", () => {
      const watchdog = new Watchdog();
      watchdog.registerNode(makePassiveConfig("passive-node"));
      watchdog.unregisterNode("passive-node");
      expect(watchdog.getNode("passive-node")).toBeUndefined();
    });

    it("should remove the node so getNodeStatus returns undefined", () => {
      const watchdog = new Watchdog();
      watchdog.registerNode(makePassiveConfig("passive-node"));
      watchdog.unregisterNode("passive-node");
      expect(watchdog.getNodeStatus("passive-node")).toBeUndefined();
    });

    it("should clear PASSIVE TTL timer so no onNodeFailure fires after unregister", () => {
      vi.useFakeTimers();
      const watchdog = new Watchdog();
      const config = makePassiveConfig("passive-node");
      watchdog.registerNode(config);

      const listener = vi.fn();
      watchdog.on("onNodeFailure", listener);

      watchdog.ping("passive-node");
      watchdog.unregisterNode("passive-node");

      vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should stop ACTIVE polling so healthCheckFn is not called after unregister", async () => {
      vi.useFakeTimers();
      const healthCheckFn = vi.fn().mockResolvedValue(true);
      const config = makeActiveConfig("active-node", healthCheckFn);
      const watchdog = new Watchdog();
      watchdog.registerNode(config);
      watchdog.start();

      await vi.advanceTimersByTimeAsync(config.intervalMs + 1);
      expect(healthCheckFn).toHaveBeenCalledOnce();

      watchdog.unregisterNode("active-node");

      await vi.advanceTimersByTimeAsync(config.intervalMs * 5);
      expect(healthCheckFn).toHaveBeenCalledOnce();

      watchdog.stop();
    });

    it("should allow re-registering a node after it has been unregistered", () => {
      const watchdog = new Watchdog();
      watchdog.registerNode(makePassiveConfig("passive-node"));
      watchdog.unregisterNode("passive-node");
      expect(() =>
        watchdog.registerNode(makePassiveConfig("passive-node"))
      ).not.toThrow();
    });

    it("should exclude unregistered node from system state", () => {
      const watchdog = new Watchdog();
      watchdog.registerNode(makePassiveConfig("node-a"));
      watchdog.registerNode(makePassiveConfig("node-b"));
      watchdog.unregisterNode("node-a");

      const state = watchdog.getSystemState();
      expect(state.nodes["node-a"]).toBeUndefined();
      expect(state.nodes["node-b"]).toBeDefined();
    });
  });
});

describe("Watchdog – Step 7: System-Level Degradation Rules", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should NOT change global state from HEALTHY when an INFO node fails", () => {
    vi.useFakeTimers();
    const watchdog = new Watchdog();
    const config: NodeConfig = {
      id: "info-node",
      type: NodeType.PASSIVE,
      intervalMs: 1000,
      gracePeriodMs: 500,
      severity: Severity.INFO,
      recoveryThreshold: 1,
    };
    watchdog.registerNode(config);

    watchdog.ping("info-node");
    vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

    expect(watchdog.getNodeStatus("info-node")?.healthy).toBe(false);
    expect(watchdog.getSystemState().status).toBe(SystemStateStatus.HEALTHY);

    watchdog.stop();
  });

  it("should change global state to DEGRADED when a WARNING node fails", () => {
    vi.useFakeTimers();
    const watchdog = new Watchdog();
    const config: NodeConfig = {
      id: "warning-node",
      type: NodeType.PASSIVE,
      intervalMs: 1000,
      gracePeriodMs: 500,
      severity: Severity.WARNING,
      recoveryThreshold: 1,
    };
    watchdog.registerNode(config);

    watchdog.ping("warning-node");
    vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

    expect(watchdog.getNodeStatus("warning-node")?.healthy).toBe(false);
    expect(watchdog.getSystemState().status).toBe(SystemStateStatus.DEGRADED);

    watchdog.stop();
  });

  it("should change global state to CRITICAL and emit onSystemCritical when a FATAL node fails", () => {
    vi.useFakeTimers();
    const watchdog = new Watchdog();
    const config: NodeConfig = {
      id: "fatal-node",
      type: NodeType.PASSIVE,
      intervalMs: 1000,
      gracePeriodMs: 500,
      severity: Severity.FATAL,
      recoveryThreshold: 1,
    };
    watchdog.registerNode(config);

    const criticalListener = vi.fn();
    watchdog.on("onSystemCritical", criticalListener);

    watchdog.ping("fatal-node");
    vi.advanceTimersByTime(config.intervalMs + config.gracePeriodMs + 1);

    expect(watchdog.getNodeStatus("fatal-node")?.healthy).toBe(false);
    expect(watchdog.getSystemState().status).toBe(SystemStateStatus.CRITICAL);
    expect(criticalListener).toHaveBeenCalledOnce();
    expect(criticalListener).toHaveBeenCalledWith(
      expect.objectContaining({ status: SystemStateStatus.CRITICAL })
    );

    watchdog.stop();
  });
});
