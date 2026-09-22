import { NextResponse } from "next/server";

import { getAgent1Policy } from "@/lib/agent1/policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const policy = getAgent1Policy();

  return NextResponse.json({
    agent: policy.agent,
    version: policy.version,
    subgraphUrl: policy.subgraphUrl,
    limits: policy.limits,
    gates: policy.gates,
    trading: policy.trading,
  });
}
