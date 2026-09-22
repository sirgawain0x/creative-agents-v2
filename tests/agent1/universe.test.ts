import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as metokensSubgraph from "@/lib/agent1/metokens-subgraph";
import { validateMeTokenUniverse } from "@/lib/agent1/universe";

const CRTVAI = "0xecb695544a3d2a64d579b3828f3f60f6932f4846";
const UNKNOWN = "0x0000000000000000000000000000000000000001";

const mockSubscribe = {
  id: "mock-id",
  meToken: CRTVAI.toLowerCase(),
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

describe("validateMeTokenUniverse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT1_DENIED_METOKENS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT1_DENIED_METOKENS;
  });

  it("rejects unknown address not in subgraph", async () => {
    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockResolvedValue(null);

    const result = await validateMeTokenUniverse(UNKNOWN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_in_subgraph");
    }
  });

  it("rejects deny-list hit even when subgraph-listed", async () => {
    process.env.AGENT1_DENIED_METOKENS = CRTVAI;
    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockResolvedValue(mockSubscribe);

    const result = await validateMeTokenUniverse(CRTVAI);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("deny_listed");
    }
  });

  it("accepts subgraph-listed token when not denied", async () => {
    vi.spyOn(metokensSubgraph, "getSubscribedMeToken").mockResolvedValue(mockSubscribe);

    const result = await validateMeTokenUniverse(CRTVAI);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meToken.symbol).toBe("CRTVAI");
    }
  });
});
