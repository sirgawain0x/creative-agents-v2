import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STAGING_HUB2_USDC_VAULT, STAGING_METOKENS_DIAMOND_ADDRESS } from "@/lib/agent1/constants";
import { dryRunUsdcToMeToken } from "@/lib/agent1/dry-run";
import * as metokensSubgraph from "@/lib/agent1/metokens-subgraph";
import { getAgent1VenueStatus } from "@/lib/agent1/venue";

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

describe("getAgent1VenueStatus", () => {
  beforeEach(() => {
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.AGENT1_HUB2_USDC_VAULT_ADDRESS;
    delete process.env.AGENT1_QUOTE_MODE;
  });

  afterEach(() => {
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.AGENT1_HUB2_USDC_VAULT_ADDRESS;
    delete process.env.AGENT1_QUOTE_MODE;
  });

  it("defaults routerConfirmed to false even when staging addresses exist", () => {
    const status = getAgent1VenueStatus();
    expect(status.venue.routerConfirmed).toBe(false);
    expect(status.gates.broadcastAllowed).toBe(false);
    expect(status.venue.addresses.stagingDiamondDefault).toBe(STAGING_METOKENS_DIAMOND_ADDRESS);
    expect(status.venue.addresses.stagingHubVaultDefault).toBe(STAGING_HUB2_USDC_VAULT);
  });

  it("does not auto-confirm when diamond env is set without AGENT1_ROUTER_CONFIRMED", () => {
    process.env.AGENT1_METOKENS_DIAMOND_ADDRESS = STAGING_METOKENS_DIAMOND_ADDRESS;
    const status = getAgent1VenueStatus();
    expect(status.venue.routerConfirmed).toBe(false);
    expect(status.venue.addresses.diamondConfigured).toBe(true);
  });

  it("confirms venue only when G2 sets AGENT1_ROUTER_CONFIRMED and diamond address", () => {
    process.env.AGENT1_ROUTER_CONFIRMED = "true";
    process.env.AGENT1_METOKENS_DIAMOND_ADDRESS = STAGING_METOKENS_DIAMOND_ADDRESS;
    process.env.AGENT1_HUB2_USDC_VAULT_ADDRESS = STAGING_HUB2_USDC_VAULT;

    const status = getAgent1VenueStatus();
    expect(status.venue.routerConfirmed).toBe(true);
    expect(status.venue.mintPath).toBe("confirmed_approve_hub_vault");
    expect(status.venue.abiLabel).toBe("foundry-facet-v1-confirmed");
  });
});

describe("dryRun venue paths", () => {
  beforeEach(() => {
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.AGENT1_HUB2_USDC_VAULT_ADDRESS;
    delete process.env.AGENT1_WALLET_ADDRESS;
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.AGENT1_DRY_RUN_PREPARE;
    process.env.TRADING_ENABLED = "false";

    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockResolvedValue(mockMeToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never broadcasts when router is confirmed", async () => {
    process.env.AGENT1_QUOTE_MODE = "mock";
    process.env.AGENT1_ROUTER_CONFIRMED = "true";
    process.env.AGENT1_METOKENS_DIAMOND_ADDRESS = STAGING_METOKENS_DIAMOND_ADDRESS;
    process.env.AGENT1_HUB2_USDC_VAULT_ADDRESS = STAGING_HUB2_USDC_VAULT;
    process.env.AGENT1_WALLET_ADDRESS = "0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10";

    const result = await dryRunUsdcToMeToken({
      meToken: mockMeToken.meToken,
      usdcAmount: "5",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.broadcast).toBe(false);
    expect(result.wouldExecute).toBe(false);
    expect(result.venue.routerConfirmed).toBe(true);
    expect(result.plannedCalls[0]?.description).toContain("Hub-2 vault");
  });
});
