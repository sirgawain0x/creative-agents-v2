import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { quoteUsdcToMeToken } from "@/lib/agent1/quote";

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

describe("quoteUsdcToMeToken", () => {
  beforeEach(() => {
    delete process.env.AGENT1_QUOTE_MODE;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.BASE_RPC_URL;
  });

  afterEach(() => {
    delete process.env.AGENT1_QUOTE_MODE;
    delete process.env.AGENT1_METOKENS_DIAMOND_ADDRESS;
    delete process.env.AGENT1_ROUTER_CONFIRMED;
    delete process.env.BASE_RPC_URL;
  });

  it("returns mock quote when diamond/RPC unset (fail-closed staging)", async () => {
    const quote = await quoteUsdcToMeToken({
      meToken: mockMeToken,
      usdcAmount: "10",
    });

    expect(quote.mode).toBe("mock");
    expect(quote.venue.routerConfirmed).toBe(false);
    expect(Number(quote.meTokensOut)).toBeGreaterThan(0);
    expect(quote.warnings).toContain("mock_quote_active");
  });

  it("throws when onchain mode requested without diamond address", async () => {
    process.env.AGENT1_QUOTE_MODE = "onchain";

    await expect(
      quoteUsdcToMeToken({
        meToken: mockMeToken,
        usdcAmount: "10",
      }),
    ).rejects.toThrow(/AGENT1_METOKENS_DIAMOND_ADDRESS/);
  });

  it("reports router confirmed only when G2 opts in", async () => {
    process.env.AGENT1_QUOTE_MODE = "mock";
    process.env.AGENT1_ROUTER_CONFIRMED = "true";
    process.env.AGENT1_METOKENS_DIAMOND_ADDRESS =
      "0xba5502db2aC2cBff189965e991C07109B14eB3f5";

    const quote = await quoteUsdcToMeToken({
      meToken: mockMeToken,
      usdcAmount: "10",
    });

    expect(quote.venue.routerConfirmed).toBe(true);
    expect(quote.venue.abiLabel).toBe("foundry-facet-v1-confirmed");
  });
});
