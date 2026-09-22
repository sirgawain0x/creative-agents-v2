import { NextRequest, NextResponse } from "next/server";

import { dryRunUsdcToMeToken } from "@/lib/agent1/dry-run";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface DryRunBody {
  meToken?: string;
  usdcAmount?: string | number;
}

function parseInput(
  source: DryRunBody | null,
  searchParams: URLSearchParams,
): { meToken?: string; usdcAmount?: string } {
  const meToken = source?.meToken ?? searchParams.get("meToken") ?? undefined;
  const rawAmount =
    source?.usdcAmount !== undefined
      ? String(source.usdcAmount)
      : searchParams.get("usdcAmount") ?? undefined;

  return { meToken, usdcAmount: rawAmount };
}

async function handleDryRun(input: { meToken?: string; usdcAmount?: string }) {
  const result = await dryRunUsdcToMeToken(input);

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
}

export async function GET(request: NextRequest) {
  const { meToken, usdcAmount } = parseInput(null, request.nextUrl.searchParams);
  return handleDryRun({ meToken, usdcAmount });
}

export async function POST(request: NextRequest) {
  let body: DryRunBody | null = null;
  try {
    body = (await request.json()) as DryRunBody;
  } catch {
    return NextResponse.json(
      {
        error: "invalid_json",
        message: "Request body must be valid JSON",
        wouldExecute: false,
        broadcast: false,
      },
      { status: 400 },
    );
  }

  try {
    const { meToken, usdcAmount } = parseInput(body, request.nextUrl.searchParams);
    return handleDryRun({ meToken, usdcAmount });
  } catch (error) {
    logger.error("agent1_dry_run_route_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      {
        error: "dry_run_failed",
        message: error instanceof Error ? error.message : "Dry-run failed",
        wouldExecute: false,
        broadcast: false,
      },
      { status: 503 },
    );
  }
}
