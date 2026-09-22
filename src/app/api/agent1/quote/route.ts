import { NextRequest, NextResponse } from "next/server";

import { getAgent1Policy } from "@/lib/agent1/policy";
import { quoteUsdcToMeToken } from "@/lib/agent1/quote";
import { isValidEthereumAddress, validateMeTokenUniverse } from "@/lib/agent1/universe";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface QuoteRequestBody {
  meToken?: string;
  usdcAmount?: string | number;
}

function parseQuoteInput(
  source: QuoteRequestBody | null,
  searchParams: URLSearchParams,
): { meToken?: string; usdcAmount?: string } {
  const meToken = source?.meToken ?? searchParams.get("meToken") ?? undefined;
  const rawAmount =
    source?.usdcAmount !== undefined
      ? String(source.usdcAmount)
      : searchParams.get("usdcAmount") ?? undefined;

  return { meToken, usdcAmount: rawAmount };
}

function parsePositiveUsdcAmount(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  const { meToken, usdcAmount } = parseQuoteInput(null, request.nextUrl.searchParams);
  return handleQuote({ meToken, usdcAmount });
}

export async function POST(request: NextRequest) {
  let body: QuoteRequestBody | null = null;
  try {
    body = (await request.json()) as QuoteRequestBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const { meToken, usdcAmount } = parseQuoteInput(body, request.nextUrl.searchParams);
  return handleQuote({ meToken, usdcAmount });
}

async function handleQuote(input: { meToken?: string; usdcAmount?: string }) {
  const policy = getAgent1Policy();

  if (!input.meToken) {
    return NextResponse.json(
      { error: "missing_metoken", message: "meToken address is required" },
      { status: 400 },
    );
  }

  if (!isValidEthereumAddress(input.meToken)) {
    return NextResponse.json(
      { error: "invalid_address", message: "Invalid MeToken address format" },
      { status: 400 },
    );
  }

  if (!input.usdcAmount) {
    return NextResponse.json(
      { error: "missing_amount", message: "usdcAmount is required" },
      { status: 400 },
    );
  }

  const usdcAmountNumber = parsePositiveUsdcAmount(input.usdcAmount);
  if (usdcAmountNumber === null) {
    return NextResponse.json(
      { error: "invalid_amount", message: "usdcAmount must be a positive number" },
      { status: 400 },
    );
  }

  if (usdcAmountNumber > policy.limits.maxTradeUsdc) {
    return NextResponse.json(
      {
        error: "oversize",
        message: `usdcAmount exceeds MAX_TRADE_USDC (${policy.limits.maxTradeUsdc})`,
      },
      { status: 400 },
    );
  }

  const universe = await validateMeTokenUniverse(input.meToken);
  if (!universe.ok) {
    const status = universe.reason === "invalid_address" ? 400 : 403;
    logger.info("agent1_quote_rejected", {
      meToken: input.meToken.toLowerCase(),
      reason: universe.reason,
    });
    return NextResponse.json(
      {
        error: universe.reason,
        message: universe.message,
        readOnly: true,
      },
      { status },
    );
  }

  try {
    const quote = await quoteUsdcToMeToken({
      meToken: universe.meToken,
      usdcAmount: String(usdcAmountNumber),
    });

    return NextResponse.json({
      agent: "agent1",
      slice: "C",
      readOnly: true,
      tradingEnabled: policy.gates.tradingEnabled,
      meToken: {
        address: universe.meToken.meToken,
        symbol: universe.meToken.symbol,
        name: universe.meToken.name,
        hubId: universe.meToken.hubId,
      },
      quote,
      policy: {
        maxTradeUsdc: policy.limits.maxTradeUsdc,
        slippageBps: policy.limits.slippageBps,
      },
    });
  } catch (error) {
    logger.error("agent1_quote_failed", {
      meToken: input.meToken.toLowerCase(),
      message: error instanceof Error ? error.message : "unknown",
    });

    return NextResponse.json(
      {
        error: "quote_failed",
        message: error instanceof Error ? error.message : "Quote failed",
        readOnly: true,
      },
      { status: 503 },
    );
  }
}
