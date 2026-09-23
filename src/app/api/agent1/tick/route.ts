import { NextRequest, NextResponse } from "next/server";

import { runAgent1Tick } from "@/lib/agent1/tick";
import { isCronAuthorized } from "@/lib/cron";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function unauthorizedResponse() {
  return NextResponse.json(
    {
      error: "unauthorized",
      message: "Valid Authorization: Bearer CRON_SECRET required",
      agent: "agent1",
      slice: "E-live",
      wouldExecute: false,
      broadcast: false,
    },
    { status: 401 },
  );
}

async function handleTick(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const result = await runAgent1Tick();

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          message: result.message,
          agent: result.agent,
          slice: result.slice,
          wouldExecute: false,
          broadcast: false,
        },
        { status: result.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error("agent1_tick_route_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });

    return NextResponse.json(
      {
        error: "tick_failed",
        message: error instanceof Error ? error.message : "Tick failed",
        agent: "agent1",
        slice: "E-live",
        wouldExecute: false,
        broadcast: false,
      },
      { status: 503 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleTick(request);
}

export async function POST(request: NextRequest) {
  return handleTick(request);
}
