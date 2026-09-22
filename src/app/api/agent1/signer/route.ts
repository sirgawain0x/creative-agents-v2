import { NextResponse } from "next/server";

import { getAgent1SignerStatus } from "@/lib/agent1/signer";

export const dynamic = "force-dynamic";

export async function GET() {
  const signer = getAgent1SignerStatus();

  return NextResponse.json({
    agent: "agent1",
    slice: "C",
    signer,
    timestamp: new Date().toISOString(),
  });
}
