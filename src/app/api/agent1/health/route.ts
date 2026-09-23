import { NextResponse } from "next/server";

import { getAgent1Policy } from "@/lib/agent1/policy";
import { listSubscribedMeTokens } from "@/lib/agent1/metokens-subgraph";
import { getAgent1SignerStatus } from "@/lib/agent1/signer";
import { getTickStateSnapshot } from "@/lib/agent1/tick-state";
import { getAgent1VenueStatus } from "@/lib/agent1/venue";
import { getAgent1WalletBalances } from "@/lib/agent1/wallet-balances";
import { getCronSecret } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function GET() {
  const policy = getAgent1Policy();
  const signer = getAgent1SignerStatus();
  const venue = getAgent1VenueStatus();
  const tickStateResult = await getTickStateSnapshot();

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
    slice: "E-prep",
    trading: policy.trading,
    venue: venue.venue,
    tick: {
      ...policy.tick,
      cronSecretConfigured: Boolean(getCronSecret()),
      state: tickStateResult.ok ? tickStateResult.data : null,
      storeError: tickStateResult.ok ? null : tickStateResult.message,
    },
    signer: {
      configured: signer.configured,
      mode: signer.mode,
      canPrepareCalls: signer.canPrepareCalls,
      canBroadcast: signer.canBroadcast,
      address: signer.address,
    },
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
