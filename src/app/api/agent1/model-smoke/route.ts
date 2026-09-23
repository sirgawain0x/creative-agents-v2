import { NextRequest, NextResponse } from "next/server";

import { getAgent1Policy } from "@/lib/agent1/policy";
import { smokeTickModel } from "@/lib/agent1/tick-model";
import { isCronAuthorized } from "@/lib/cron";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const NEVER_EXECUTES =
  "This endpoint probes tick model connectivity only; it never executes trades or broadcasts.";

function unauthorizedResponse() {
  return NextResponse.json(
    {
      error: "unauthorized",
      message: "Valid Authorization: Bearer CRON_SECRET required",
      agent: "agent1",
      ok: false,
      tradingEnabled: false,
      wouldExecute: false,
      broadcast: false,
    },
    { status: 401 },
  );
}

function smokeFailureStatus(error: string): number {
  switch (error) {
    case "model_credentials_missing":
    case "gemini_key_missing":
    case "ai_gateway_key_missing":
    case "ollama_unset":
      return 503;
    default:
      return 502;
  }
}

async function handleModelSmoke() {
  const policy = getAgent1Policy();
  const tradingEnabled = policy.gates.tradingEnabled;

  try {
    const result = await smokeTickModel();

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          message: result.message,
          agent: "agent1",
          ...(result.provider ? { provider: result.provider } : {}),
          ...(result.model ? { model: result.model } : {}),
          tradingEnabled,
          wouldExecute: false,
          broadcast: false,
          note: NEVER_EXECUTES,
        },
        { status: smokeFailureStatus(result.error) },
      );
    }

    return NextResponse.json({
      ok: true,
      agent: "agent1",
      provider: result.provider,
      model: result.model,
      responseOkParsed: result.responseOkParsed,
      tradingEnabled,
      wouldExecute: false,
      broadcast: false,
      note: NEVER_EXECUTES,
    });
  } catch (error) {
    logger.error("agent1_model_smoke_route_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });

    return NextResponse.json(
      {
        ok: false,
        error: "model_smoke_failed",
        message: error instanceof Error ? error.message : "Model smoke failed",
        agent: "agent1",
        tradingEnabled,
        wouldExecute: false,
        broadcast: false,
        note: NEVER_EXECUTES,
      },
      { status: 503 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return unauthorizedResponse();
  }
  return handleModelSmoke();
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return unauthorizedResponse();
  }
  return handleModelSmoke();
}
