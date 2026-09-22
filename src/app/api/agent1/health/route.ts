import { NextResponse } from "next/server";

import { getAgent1Policy } from "@/lib/agent1/policy";
import { listSubscribedMeTokens } from "@/lib/agent1/metokens-subgraph";
import { getAgent1WalletBalances } from "@/lib/agent1/wallet-balances";

export const dynamic = "force-dynamic";

export async function GET() {
  const policy = getAgent1Policy();

  let meTokenCount: number | null = null;
  let subgraphError: string | null = null;

  try {
    const tokens = await listSubscribedMeTokens(5, 0);
    meTokenCount = tokens.length;
  } catch (error) {
    subgraphError = error instanceof Error ? error.message : "subgraph_unavailable";
  }

  const walletBalances = await getAgent1WalletBalances();

  return NextResponse.json({
    status: subgraphError ? "degraded" : "ok",
    agent: "agent1",
    slice: "B",
    trading: policy.trading,
    subgraph: {
      providerMode: policy.subgraph.providerMode,
      studioUrl: policy.subgraph.studioUrl,
      meTokenSampleCount: meTokenCount,
      error: subgraphError,
    },
    wallet: walletBalances,
    timestamp: new Date().toISOString(),
  });
}
