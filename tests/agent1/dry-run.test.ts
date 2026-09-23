import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as dryRunModule from "@/lib/agent1/dry-run";
import * as metokensSubgraph from "@/lib/agent1/metokens-subgraph";
import * as signerModule from "@/lib/agent1/signer";

const mockMeToken = {
  id: "mock",
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

describe("getAgent1SignerStatus", () => {
  beforeEach(() => {
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.ALCHEMY_WALLET_API_KEY;
    delete process.env.ALCHEMY_GAS_POLICY_ID;
    delete process.env.AGENT1_WALLET_ADDRESS;
  });

  afterEach(() => {
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.ALCHEMY_WALLET_API_KEY;
    delete process.env.ALCHEMY_GAS_POLICY_ID;
    delete process.env.AGENT1_WALLET_ADDRESS;
  });

  it("reports unconfigured when credentials missing", () => {
    const status = signerModule.getAgent1SignerStatus();
    expect(status.configured).toBe(false);
    expect(status.canPrepareCalls).toBe(false);
    expect(status.canBroadcast).toBe(false);
    expect(status.mode).toBe("unconfigured");
  });

  it("reports configured when API key + wallet address are set", () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    process.env.AGENT1_WALLET_ADDRESS = "0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10";

    const status = signerModule.getAgent1SignerStatus();
    expect(status.configured).toBe(true);
    expect(status.canPrepareCalls).toBe(true);
    expect(status.canBroadcast).toBe(false);
    expect(status.mode).toBe("api_key");
  });
});

describe("dryRunUsdcToMeToken", () => {
  beforeEach(() => {
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.AGENT1_WALLET_ADDRESS;
    delete process.env.AGENT1_DRY_RUN_PREPARE;
    delete process.env.AGENT1_QUOTE_MODE;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.BASE_RPC_URL;
    process.env.TRADING_ENABLED = "false";
    process.env.KILL_SWITCH = "false";

    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockResolvedValue(mockMeToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.AGENT1_WALLET_ADDRESS;
    delete process.env.AGENT1_DRY_RUN_PREPARE;
    delete process.env.TRADING_ENABLED;
    delete process.env.KILL_SWITCH;
  });

  it("returns a local dry-run plan without broadcasting", async () => {
    const result = await dryRunModule.dryRunUsdcToMeToken({
      meToken: mockMeToken.meToken,
      usdcAmount: "10",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.slice).toBe("E-prep");
    expect(result.wouldExecute).toBe(false);
    expect(result.broadcast).toBe(false);
    expect(result.plannedCalls).toHaveLength(2);
    expect(result.plannedCalls[0]?.step).toBe("approve_usdc");
    expect(result.plannedCalls[1]?.step).toBe("mint_metoken");
    expect(result.alchemyPrepare.attempted).toBe(false);
    expect(result.trading.executed).toBe(false);
    expect(result.warnings).toContain("slice_e_prep_dry_run_only");
  });

  it("rejects oversize amounts", async () => {
    const result = await dryRunModule.dryRunUsdcToMeToken({
      meToken: mockMeToken.meToken,
      usdcAmount: "9999",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe("oversize");
    expect(result.wouldExecute).toBe(false);
    expect(result.broadcast).toBe(false);
  });

  it("never broadcasts even when Alchemy prepare is configured", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    process.env.AGENT1_WALLET_ADDRESS = "0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10";
    process.env.AGENT1_DRY_RUN_PREPARE = "true";

    vi.spyOn(signerModule, "prepareAlchemyCalls").mockResolvedValue({
      ok: true,
      prepared: { type: "user-operation-v070", data: { mock: true } },
    });

    const result = await dryRunModule.dryRunUsdcToMeToken({
      meToken: mockMeToken.meToken,
      usdcAmount: "5",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.broadcast).toBe(false);
    expect(result.wouldExecute).toBe(false);
    expect(result.signer.canBroadcast).toBe(false);
    expect(result.alchemyPrepare.attempted).toBe(true);
    if (result.alchemyPrepare.attempted) {
      expect(result.alchemyPrepare.ok).toBe(true);
    }
    expect(signerModule.prepareAlchemyCalls).toHaveBeenCalledOnce();
  });
});
