import { describe, expect, it } from "vitest";

import {
  getSubgraphMeta,
  listSubscribedMeTokens,
} from "@/lib/agent1/metokens-subgraph";

describe("creative-platform subgraph smoke", () => {
  it("enumerates at least one live MeToken from Studio subgraph", async () => {
    const meta = await getSubgraphMeta();
    expect(meta.hasIndexingErrors).toBe(false);

    const tokens = await listSubscribedMeTokens(5, 0);
    expect(tokens.length).toBeGreaterThanOrEqual(1);

    const first = tokens[0];
    expect(first.meToken).toMatch(/^0x[a-f0-9]{40}$/);
    expect(first.symbol.length).toBeGreaterThan(0);
    expect(first.hubId).toBeTruthy();
  });
});
