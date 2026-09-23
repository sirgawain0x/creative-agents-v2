import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  executeTradingNoOp,
  getAgent1Policy,
  getTradingBroadcastEligibility,
} from "@/lib/agent1/policy";
import { STAGING_METOKENS_DIAMOND_ADDRESS } from "@/lib/agent1/constants";

describe("getAgent1Policy slice E live", () => {
  beforeEach(() => {
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    delete process.env.AGENT1_BROADCAST_ENABLED;
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  afterEach(() => {
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    delete process.env.AGENT1_BROADCAST_ENABLED;
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  it("defaults to disabled dry-run gates", () => {
    const policy = getAgent1Policy();
    expect(policy.version).toBe("slice-e-live");
    expect(policy.trading.mode).toBe("disabled");
    expect(policy.gates.tradingEnabled).toBe(false);
    expect(policy.gates.broadcastEnabled).toBe(false);
    expect(policy.tick.store.backend).toBe("memory");
    expect(policy.venue.routerConfirmed).toBe(false);
    expect(policy.venue.broadcastAllowed).toBe(false);
  });

  it("uses dry_run mode when trading enabled without broadcast", () => {
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "false";

    const policy = getAgent1Policy();
    expect(policy.trading.mode).toBe("dry_run");
    expect(policy.trading.reason).toBe("trading_enabled_dry_run_only_broadcast_disabled");
  });

  it("uses live mode only when every broadcast gate is open", () => {
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "false";
    process.env.AGENT1_BROADCAST_ENABLED = "true";
    process.env.AGENT1_ROUTER_CONFIRMED = "true";
    process.env.AGENT1_METOKENS_DIAMOND_ADDRESS = STAGING_METOKENS_DIAMOND_ADDRESS;

    const policy = getAgent1Policy();
    expect(policy.trading.mode).toBe("live");
    expect(policy.trading.reason).toBe("live_broadcast_enabled");
    expect(policy.venue.broadcastAllowed).toBe(true);
  });

  it("reports upstash backend when redis env is set", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";

    const policy = getAgent1Policy();
    expect(policy.tick.store.backend).toBe("upstash");
    expect(policy.tick.store.persistent).toBe(true);
  });

  it("uses the Vercel KV REST credentials when Upstash names are unset", () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";

    const policy = getAgent1Policy();
    expect(policy.tick.store.backend).toBe("upstash");
    expect(policy.tick.store.persistent).toBe(true);
  });

  it("ignores non-URL Upstash values and falls back to KV REST credentials", () => {
    process.env.UPSTASH_REDIS_REST_URL = "${KV_REST_API_URL}";
    process.env.UPSTASH_REDIS_REST_TOKEN = "${KV_REST_API_TOKEN}";
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";

    const policy = getAgent1Policy();
    expect(policy.tick.store.backend).toBe("upstash");
    expect(policy.tick.store.persistent).toBe(true);
  });

  it("executeTradingNoOp never executes when gates are closed", () => {
    process.env.TRADING_ENABLED = "true";
    const result = executeTradingNoOp("test");
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("slice_e_live_dry_run_only");
  });

  it("getTradingBroadcastEligibility is fail-closed by default", () => {
    const eligibility = getTradingBroadcastEligibility();
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.reason).toBe("trading_disabled");
  });
});
