import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/agent1/tick/route";
import { BASE_USDC_ADDRESS } from "@/lib/agent1/constants";
import * as dryRunModule from "@/lib/agent1/dry-run";
import * as metokensSubgraph from "@/lib/agent1/metokens-subgraph";
import { runAgent1Tick } from "@/lib/agent1/tick";
import {
  checkCooldown,
  checkDailyVolumeCapacity,
  recordPlannedDryRun,
  resetTickStateForTests,
} from "@/lib/agent1/tick-state";
import { isCronAuthorized } from "@/lib/cron";

const mockMeToken = {
  id: "mock-1",
  meToken: "0xecb695544a3d2a64d579b3828f3f60f6932f4846",
  owner: "0xde4b0371bba20602685916ceee5b22025a811734",
  name: "Creative AI Token",
  symbol: "CRTVAI",
  hubId: "2",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  assetsDeposited: "0",
  timestamp: "1783664813",
  blockNumber: "1",
  transactionHash: "0xabc",
};

const mockMeToken2 = {
  ...mockMeToken,
  id: "mock-2",
  meToken: "0x1111111111111111111111111111111111111111",
  symbol: "MOCK2",
  name: "Mock Token 2",
};

function makeTickRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  return new NextRequest("http://localhost/api/agent1/tick", { headers });
}

describe("isCronAuthorized", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects when CRON_SECRET is unset (fail-closed)", () => {
    const request = makeTickRequest("anything");
    expect(isCronAuthorized(request)).toBe(false);
  });

  it("rejects missing or wrong bearer token", () => {
    process.env.CRON_SECRET = "expected-secret";

    expect(isCronAuthorized(makeTickRequest())).toBe(false);
    expect(isCronAuthorized(makeTickRequest("wrong-secret"))).toBe(false);
  });

  it("accepts a valid bearer token", () => {
    process.env.CRON_SECRET = "expected-secret";
    expect(isCronAuthorized(makeTickRequest("expected-secret"))).toBe(true);
  });
});

describe("tick route auth", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    vi.spyOn(metokensSubgraph, "listSubscribedMeTokens").mockResolvedValue([mockMeToken]);
    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockResolvedValue(mockMeToken);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("returns 401 when CRON_SECRET is set but auth is missing", async () => {
    process.env.CRON_SECRET = "expected-secret";

    const response = await GET(makeTickRequest());
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("unauthorized");
    expect(body.wouldExecute).toBe(false);
    expect(body.broadcast).toBe(false);
  });

  it("returns 401 when CRON_SECRET is unset (fail-closed)", async () => {
    const response = await POST(makeTickRequest("anything"));
    expect(response.status).toBe(401);
  });
});

describe("runAgent1Tick", () => {
  beforeEach(() => {
    resetTickStateForTests();
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    delete process.env.AGENT1_DENIED_METOKENS;
    delete process.env.AGENT1_TICK_MODEL_ENABLED;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.AI_GATEWAY_API_KEY;

    vi.spyOn(metokensSubgraph, "listSubscribedMeTokens").mockResolvedValue([
      mockMeToken,
      mockMeToken2,
    ]);
    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockImplementation(async (address) => {
      const normalized = address.toLowerCase();
      if (normalized === mockMeToken.meToken.toLowerCase()) {
        return mockMeToken;
      }
      if (normalized === mockMeToken2.meToken.toLowerCase()) {
        return mockMeToken2;
      }
      return null;
    });
  });

  afterEach(() => {
    resetTickStateForTests();
    vi.restoreAllMocks();
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    delete process.env.AGENT1_DENIED_METOKENS;
  });

  it("skips when trading is disabled", async () => {
    process.env.TRADING_ENABLED = "false";

    const result = await runAgent1Tick();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.decision.action).toBe("skipped");
    expect(result.decision.reason).toBe("trading_disabled");
    expect(result.wouldExecute).toBe(false);
    expect(result.broadcast).toBe(false);
    expect(result.dryRun).toBeNull();
  });

  it("skips when kill switch is active", async () => {
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "true";

    const result = await runAgent1Tick();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.decision.action).toBe("skipped");
    expect(result.decision.reason).toBe("kill_switch_active");
    expect(result.wouldExecute).toBe(false);
    expect(result.broadcast).toBe(false);
  });

  it("plans a dry-run tick without broadcasting", async () => {
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "false";

    const result = await runAgent1Tick();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.decision.action).toBe("planned");
    expect(result.decision.candidateStrategy).toBe("newest_subscribe_first");
    expect(result.wouldExecute).toBe(false);
    expect(result.broadcast).toBe(false);
    expect(result.dryRun).not.toBeNull();
    expect(result.dryRun?.wouldExecute).toBe(false);
    expect(result.dryRun?.broadcast).toBe(false);
    expect(result.candidatesConsidered.some((candidate) => candidate.selected)).toBe(true);
  });

  it("never broadcasts even when dry-run prepare succeeds", async () => {
    process.env.TRADING_ENABLED = "true";

    vi.spyOn(dryRunModule, "dryRunUsdcToMeToken").mockResolvedValue({
      ok: true,
      agent: "agent1",
      slice: "C",
      wouldExecute: false,
      broadcast: false,
      meToken: {
        address: mockMeToken.meToken,
        symbol: mockMeToken.symbol,
        name: mockMeToken.name,
        hubId: mockMeToken.hubId,
      },
      quote: {
        mode: "mock",
        inputAsset: BASE_USDC_ADDRESS,
        outputToken: mockMeToken.meToken,
        usdcIn: "25",
        usdcInRaw: "25000000",
        meTokensOut: "8.75",
        meTokensOutRaw: "8750000000000000000",
        slippageBpsEstimate: null,
        venue: {
          type: "metokens_diamond_mint_quote",
          diamondAddress: null,
          routerConfirmed: false,
          note: "test",
        },
        warnings: [],
      },
      plannedCalls: [],
      signer: {
        slice: "C",
        configured: true,
        mode: "api_key",
        address: "0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10",
        alchemyApiKeyPresent: true,
        gasPolicyIdPresent: false,
        canPrepareCalls: true,
        canBroadcast: false,
        note: "test",
      },
      alchemyPrepare: { attempted: true, ok: true, prepared: { mock: true } },
      trading: { executed: false, reason: "slice_d_dry_run_only" },
      policy: {
        gates: { tradingEnabled: true, killSwitch: false },
        limits: {
          maxTradeUsdc: 25,
          dailyVolumeUsdc: 100,
          slippageBps: 250,
          cooldownSeconds: 1800,
        },
        trading: { mode: "dry_run", reason: "trading_enabled_but_slice_d_dry_run_only" },
      },
      warnings: ["slice_c_dry_run_only"],
    });

    const result = await runAgent1Tick();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.broadcast).toBe(false);
    expect(result.wouldExecute).toBe(false);
    expect(result.dryRun?.broadcast).toBe(false);
    expect(result.dryRun?.wouldExecute).toBe(false);
    expect(result.dryRun?.signer.canBroadcast).toBe(false);
  });
});

describe("tick-state policy gates", () => {
  beforeEach(() => {
    resetTickStateForTests();
  });

  afterEach(() => {
    resetTickStateForTests();
  });

  it("tracks daily volume capacity", () => {
    expect(checkDailyVolumeCapacity(25, 100).ok).toBe(true);
    recordPlannedDryRun(25);
    expect(checkDailyVolumeCapacity(25, 100).ok).toBe(true);
    recordPlannedDryRun(25);
    recordPlannedDryRun(25);
    recordPlannedDryRun(25);
    const blocked = checkDailyVolumeCapacity(25, 100);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) {
      return;
    }
    expect(blocked.reason).toBe("daily_volume_exceeded");
  });

  it("enforces cooldown between planned ticks", () => {
    recordPlannedDryRun(10);
    const blocked = checkCooldown(1800);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) {
      return;
    }
    expect(blocked.reason).toBe("cooldown_active");
  });
});

describe("tick route happy path", () => {
  beforeEach(() => {
    resetTickStateForTests();
    process.env.CRON_SECRET = "expected-secret";
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "false";

    vi.spyOn(metokensSubgraph, "listSubscribedMeTokens").mockResolvedValue([mockMeToken]);
    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockResolvedValue(mockMeToken);
  });

  afterEach(() => {
    resetTickStateForTests();
    delete process.env.CRON_SECRET;
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    vi.restoreAllMocks();
  });

  it("returns a dry tick result when authorized", async () => {
    const response = await GET(makeTickRequest("expected-secret"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.slice).toBe("D");
    expect(body.wouldExecute).toBe(false);
    expect(body.broadcast).toBe(false);
    expect(body.decision.action).toBe("planned");
  });
});
