import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/agent1/tick/route";
import { BASE_USDC_ADDRESS, STAGING_HUB2_USDC_VAULT, STAGING_METOKENS_DIAMOND_ADDRESS } from "@/lib/agent1/constants";
import * as dryRunModule from "@/lib/agent1/dry-run";
import * as metokensSubgraph from "@/lib/agent1/metokens-subgraph";
import * as signerModule from "@/lib/agent1/signer";
import * as tickModel from "@/lib/agent1/tick-model";
import { runAgent1Tick } from "@/lib/agent1/tick";
import {
  checkCooldown,
  checkDailyVolumeCapacity,
  recordPlannedDryRun,
  resetTickStateForTests,
  setTickStoreForTests,
  type Agent1TickStore,
  type PersistedTickState,
} from "@/lib/agent1/tick-state";
import { getUtcDayKey } from "@/lib/agent1/tick-state-store";
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

class MemoryTickStore implements Agent1TickStore {
  readonly backend = "memory" as const;
  readonly persistent = false;
  private state: PersistedTickState = {
    dailyVolumeUsedUsdc: 0,
    dailyVolumeDayUtc: getUtcDayKey(),
    lastPlannedAtMs: null,
  };

  async load(): Promise<PersistedTickState> {
    const day = getUtcDayKey();
    if (this.state.dailyVolumeDayUtc !== day) {
      this.state = {
        dailyVolumeUsedUsdc: 0,
        dailyVolumeDayUtc: day,
        lastPlannedAtMs: this.state.lastPlannedAtMs,
      };
    }
    return { ...this.state };
  }

  async save(state: PersistedTickState): Promise<void> {
    this.state = { ...state };
  }
}

function makeDryRunSuccess(overrides?: Partial<dryRunModule.Agent1DryRunSuccess>): dryRunModule.Agent1DryRunSuccess {
  return {
    ok: true,
    agent: "agent1",
    slice: "E-live",
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
        diamondAddress: STAGING_METOKENS_DIAMOND_ADDRESS,
        routerConfirmed: false,
        abiLabel: "foundry-facet-v1-provisional",
        quoteMode: "mock",
        mintPath: "provisional_approve_diamond",
        note: "test",
        addresses: {
          diamond: STAGING_METOKENS_DIAMOND_ADDRESS,
          diamondConfigured: false,
          hub2UsdcVault: STAGING_HUB2_USDC_VAULT,
          hubVaultConfigured: false,
          stagingDiamondDefault: STAGING_METOKENS_DIAMOND_ADDRESS,
          stagingHubVaultDefault: STAGING_HUB2_USDC_VAULT,
        },
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
    trading: { executed: false, reason: "slice_e_live_dry_run_only" },
    policy: {
      gates: { tradingEnabled: true, killSwitch: false, broadcastEnabled: false },
      limits: {
        maxTradeUsdc: 25,
        dailyVolumeUsdc: 100,
        slippageBps: 250,
        cooldownSeconds: 1800,
      },
      trading: { mode: "dry_run", reason: "trading_enabled_dry_run_only_broadcast_disabled" },
    },
    venue: {
      type: "metokens_diamond_mint",
      routerConfirmed: false,
      abiLabel: "foundry-facet-v1-provisional",
      quoteMode: "mock",
      mintPath: "provisional_approve_diamond",
      note: "test",
      addresses: {
        diamond: STAGING_METOKENS_DIAMOND_ADDRESS,
        diamondConfigured: false,
        hub2UsdcVault: STAGING_HUB2_USDC_VAULT,
        hubVaultConfigured: false,
        stagingDiamondDefault: STAGING_METOKENS_DIAMOND_ADDRESS,
        stagingHubVaultDefault: STAGING_HUB2_USDC_VAULT,
      },
    },
    warnings: ["dry_run_plan_only"],
    ...overrides,
  };
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
    expect(body.slice).toBe("E-live");
  });

  it("returns 401 when CRON_SECRET is unset (fail-closed)", async () => {
    const response = await POST(makeTickRequest("anything"));
    expect(response.status).toBe(401);
  });
});

describe("runAgent1Tick", () => {
  beforeEach(async () => {
    setTickStoreForTests(new MemoryTickStore());
    await resetTickStateForTests();
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    delete process.env.AGENT1_BROADCAST_ENABLED;
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.AGENT1_DENIED_METOKENS;
    delete process.env.AGENT1_TICK_MODEL_ENABLED;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.AGENT1_WALLET_ADDRESS;

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

  afterEach(async () => {
    await resetTickStateForTests();
    setTickStoreForTests(null);
    vi.restoreAllMocks();
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    delete process.env.AGENT1_BROADCAST_ENABLED;
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.AGENT1_DENIED_METOKENS;
    delete process.env.AGENT1_TICK_MODEL_ENABLED;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.AGENT1_WALLET_ADDRESS;
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
    expect(result.slice).toBe("E-live");
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

  it("does not broadcast when prepare succeeds but gates are closed", async () => {
    process.env.TRADING_ENABLED = "true";

    vi.spyOn(dryRunModule, "dryRunUsdcToMeToken").mockResolvedValue(makeDryRunSuccess());

    const result = await runAgent1Tick();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.broadcast).toBe(false);
    expect(result.wouldExecute).toBe(false);
    expect(result.decision.action).toBe("planned");
    expect(result.dryRun?.broadcast).toBe(false);
    expect(result.dryRun?.wouldExecute).toBe(false);
    expect(result.dryRun?.signer.canBroadcast).toBe(false);
  });

  it("broadcasts when every live gate is open and prepared calls are signed", async () => {
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "false";
    process.env.AGENT1_BROADCAST_ENABLED = "true";
    process.env.AGENT1_ROUTER_CONFIRMED = "true";
    process.env.AGENT1_METOKENS_DIAMOND_ADDRESS = STAGING_METOKENS_DIAMOND_ADDRESS;
    process.env.ALCHEMY_API_KEY = "test-key";
    process.env.AGENT1_WALLET_ADDRESS = "0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10";

    const signedPrepared = {
      type: "user-operation-v070",
      data: { sender: "0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10" },
      signature: { type: "secp256k1", data: "0xsig" },
    };

    vi.spyOn(dryRunModule, "dryRunUsdcToMeToken").mockResolvedValue(
      makeDryRunSuccess({
        alchemyPrepare: { attempted: true, ok: true, prepared: signedPrepared },
        signer: {
          slice: "C",
          configured: true,
          mode: "api_key",
          address: "0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10",
          alchemyApiKeyPresent: true,
          gasPolicyIdPresent: false,
          canPrepareCalls: true,
          canBroadcast: true,
          note: "test",
        },
        venue: {
          type: "metokens_diamond_mint",
          routerConfirmed: true,
          abiLabel: "foundry-facet-v1-confirmed",
          quoteMode: "mock",
          mintPath: "confirmed_approve_hub_vault",
          note: "test",
          addresses: {
            diamond: STAGING_METOKENS_DIAMOND_ADDRESS,
            diamondConfigured: true,
            hub2UsdcVault: STAGING_HUB2_USDC_VAULT,
            hubVaultConfigured: true,
            stagingDiamondDefault: STAGING_METOKENS_DIAMOND_ADDRESS,
            stagingHubVaultDefault: STAGING_HUB2_USDC_VAULT,
          },
        },
        policy: {
          gates: { tradingEnabled: true, killSwitch: false, broadcastEnabled: true },
          limits: {
            maxTradeUsdc: 25,
            dailyVolumeUsdc: 100,
            slippageBps: 250,
            cooldownSeconds: 1800,
          },
          trading: { mode: "live", reason: "live_broadcast_enabled" },
        },
      }),
    );

    vi.spyOn(signerModule, "sendPreparedAlchemyCalls").mockResolvedValue({
      ok: true,
      result: { id: "0xbroadcast" },
    });

    const result = await runAgent1Tick();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.decision.action).toBe("executed");
    expect(result.broadcast).toBe(true);
    expect(result.wouldExecute).toBe(true);
    expect(result.trading.executed).toBe(true);
    expect(result.broadcastAttempt?.ok).toBe(true);
    expect(signerModule.sendPreparedAlchemyCalls).toHaveBeenCalledWith(signedPrepared);
  });

  it("uses model-assisted selection when Gemini path succeeds", async () => {
    process.env.TRADING_ENABLED = "true";
    process.env.AGENT1_TICK_MODEL_ENABLED = "true";
    process.env.GEMINI_API_KEY = "gemini-test";

    vi.spyOn(tickModel, "selectCandidateWithModel").mockResolvedValue({
      ok: true,
      meToken: mockMeToken2.meToken.toLowerCase(),
      provider: "gemini",
      model: "gemini-2.0-flash",
    });

    const result = await runAgent1Tick();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.decision.modelUsed).toBe(true);
    expect(result.decision.candidateStrategy).toBe("model_assisted");
    expect(result.candidatesConsidered.find((c) => c.selected)?.meToken.toLowerCase()).toBe(
      mockMeToken2.meToken.toLowerCase(),
    );
  });

  it("skips planning when tick store fails (fail-closed)", async () => {
    process.env.TRADING_ENABLED = "true";

    const failingStore: Agent1TickStore = {
      backend: "memory",
      persistent: false,
      load: vi.fn().mockRejectedValue(new Error("redis down")),
      save: vi.fn(),
    };
    setTickStoreForTests(failingStore);

    const result = await runAgent1Tick();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.decision.action).toBe("skipped");
    expect(result.decision.reason).toBe("tick_store_error");
    expect(result.dryRun).toBeNull();
    expect(result.warnings).toContain("tick_store_error");
  });
});

describe("tick-state policy gates", () => {
  beforeEach(async () => {
    setTickStoreForTests(new MemoryTickStore());
    await resetTickStateForTests();
  });

  afterEach(async () => {
    await resetTickStateForTests();
    setTickStoreForTests(null);
  });

  it("persists volume when reusing the same memory store instance", async () => {
    const store = new MemoryTickStore();
    setTickStoreForTests(store);

    expect((await checkDailyVolumeCapacity(25, 100)).ok).toBe(true);
    await recordPlannedDryRun(25);
    await recordPlannedDryRun(25);
    await recordPlannedDryRun(25);
    await recordPlannedDryRun(25);

    const blocked = await checkDailyVolumeCapacity(25, 100);
    expect(blocked.ok).toBe(true);
    if (!blocked.ok || blocked.data.ok) {
      return;
    }
    expect(blocked.data.reason).toBe("daily_volume_exceeded");
  });

  it("enforces cooldown between planned ticks", async () => {
    await recordPlannedDryRun(10);
    const blocked = await checkCooldown(1800);
    expect(blocked.ok).toBe(true);
    if (!blocked.ok || blocked.data.ok) {
      return;
    }
    expect(blocked.data.reason).toBe("cooldown_active");
  });

  it("fail-closed when store load errors", async () => {
    setTickStoreForTests({
      backend: "memory",
      persistent: false,
      load: async () => {
        throw new Error("load failed");
      },
      save: async () => {},
    });

    const result = await checkDailyVolumeCapacity(10, 100);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("tick_store_error");
  });
});

describe("tick route happy path", () => {
  beforeEach(async () => {
    setTickStoreForTests(new MemoryTickStore());
    await resetTickStateForTests();
    process.env.CRON_SECRET = "expected-secret";
    process.env.TRADING_ENABLED = "true";
    process.env.KILL_SWITCH = "false";

    vi.spyOn(metokensSubgraph, "listSubscribedMeTokens").mockResolvedValue([mockMeToken]);
    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockResolvedValue(mockMeToken);
  });

  afterEach(async () => {
    await resetTickStateForTests();
    setTickStoreForTests(null);
    delete process.env.CRON_SECRET;
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
    vi.restoreAllMocks();
  });

  it("returns a dry tick result when authorized", async () => {
    const response = await GET(makeTickRequest("expected-secret"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.slice).toBe("E-live");
    expect(body.wouldExecute).toBe(false);
    expect(body.broadcast).toBe(false);
    expect(body.decision.action).toBe("planned");
  });
});
