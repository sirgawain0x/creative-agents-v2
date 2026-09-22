import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    agent: "agent2",
    slice: "stub",
    message: "Agent 2 health stub — implementation pending future slice",
    timestamp: new Date().toISOString(),
  });
}
