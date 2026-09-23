import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeTradingNoOp, getAgent1Policy } from "@/lib/agent1/policy";

describe("getAgent1Policy slice E prep", () => {
  beforeEach(() => {
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("defaults to disabled dry-run gates", () => {
    const policy = getAgent1Policy();
    expect(policy.version).toBe("slice-e-prep");
    expect(policy.trading.mode).toBe("disabled");
    expect(policy.gates.tradingEnabled).toBe(false);
    expect(policy.tick.store.backend).toBe("memory");
    expect(policy.venue.routerConfirmed).toBe(false);
  });

  it("uses dry_run mode when trading enabled without kill switch", () => {
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "false";

    const policy = getAgent1Policy();
    expect(policy.trading.mode).toBe("dry_run");
    expect(policy.trading.reason).toBe("trading_enabled_but_slice_e_prep_dry_run_only");
  });

  it("reports upstash backend when redis env is set", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";

    const policy = getAgent1Policy();
    expect(policy.tick.store.backend).toBe("upstash");
    expect(policy.tick.store.persistent).toBe(true);
  });

  it("executeTradingNoOp never executes", () => {
    process.env.TRADING_ENABLED = "true";
    const result = executeTradingNoOp("test");
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("slice_e_prep_dry_run_only");
  });
});
