import { NextResponse } from "next/server";

import { getAgent1Policy } from "@/lib/agent1/policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const policy = getAgent1Policy();

  return NextResponse.json({
    status: "ok",
    agent: "agent1",
    slice: "A",
    trading: policy.trading,
    timestamp: new Date().toISOString(),
  });
}
