import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeTradingNoOp, getAgent1Policy } from "@/lib/agent1/policy";

describe("getAgent1Policy slice D", () => {
  beforeEach(() => {
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
  });

  afterEach(() => {
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
  });

  it("defaults to disabled dry-run gates", () => {
    const policy = getAgent1Policy();
    expect(policy.version).toBe("slice-d");
    expect(policy.trading.mode).toBe("disabled");
    expect(policy.gates.tradingEnabled).toBe(false);
  });

  it("uses dry_run mode when trading enabled without kill switch", () => {
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "false";

    const policy = getAgent1Policy();
    expect(policy.trading.mode).toBe("dry_run");
    expect(policy.trading.reason).toBe("trading_enabled_but_slice_d_dry_run_only");
  });

  it("executeTradingNoOp never executes", () => {
    process.env.TRADING_ENABLED = "true";
    const result = executeTradingNoOp("test");
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("slice_d_dry_run_only");
  });
});
