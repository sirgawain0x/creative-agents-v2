import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/agent1/model-smoke/route";
import { smokeTickModel } from "@/lib/agent1/tick-model";

function makeModelSmokeRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  return new NextRequest("http://localhost/api/agent1/model-smoke", { headers });
}

describe("agent1 model-smoke route", () => {
  const cronSecret = "test-cron-secret-smoke";

  beforeEach(() => {
    process.env.CRON_SECRET = cronSecret;
    delete process.env.TRADING_ENABLED;
    delete process.env.AGENT1_BROADCAST_ENABLED;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_AI_GATEWAY_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.TRADING_ENABLED;
    delete process.env.AGENT1_BROADCAST_ENABLED;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.AGENT1_TICK_MODEL;
  });

  it("returns 401 when cron secret is missing or invalid", async () => {
    for (const handler of [GET, POST]) {
      const noAuth = await handler(makeModelSmokeRequest());
      expect(noAuth.status).toBe(401);
      const noAuthBody = await noAuth.json();
      expect(noAuthBody).toMatchObject({
        error: "unauthorized",
        agent: "agent1",
        ok: false,
        tradingEnabled: false,
        wouldExecute: false,
        broadcast: false,
      });

      const badAuth = await handler(makeModelSmokeRequest("wrong-secret"));
      expect(badAuth.status).toBe(401);
    }
  });

  it("returns provider and model on success without enabling trading or broadcast", async () => {
    process.env.AI_GATEWAY_API_KEY = "gateway-test-key";
    process.env.AGENT1_TICK_MODEL = "gemini-2.5-pro";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const response = await GET(makeModelSmokeRequest(cronSecret));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      agent: "agent1",
      provider: "ai_gateway",
      model: "google/gemini-2.5-pro",
      tradingEnabled: false,
      wouldExecute: false,
      broadcast: false,
    });
    expect(body.note).toMatch(/never executes trades/i);
  });
});

describe("smokeTickModel", () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.AGENT1_TICK_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.AGENT1_TICK_MODEL;
  });

  it("uses AI Gateway when Gemini keys are absent and returns provider/model shape", async () => {
    process.env.AI_GATEWAY_API_KEY = "gateway-key";
    process.env.AGENT1_TICK_MODEL = "gemini-2.5-pro";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      ),
    );

    const result = await smokeTickModel();
    expect(result).toEqual({
      ok: true,
      provider: "ai_gateway",
      model: "google/gemini-2.5-pro",
    });
  });

  it("fail-softs when no credentials are configured", async () => {
    const result = await smokeTickModel();
    expect(result).toMatchObject({
      ok: false,
      error: "model_credentials_missing",
    });
  });
});
