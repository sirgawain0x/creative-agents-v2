import { NextResponse } from "next/server";

import { getAgent1VenueStatus } from "@/lib/agent1/venue";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = getAgent1VenueStatus();

  return NextResponse.json(status);
}
