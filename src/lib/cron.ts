import { NextRequest } from "next/server";

import { logger } from "@/lib/logger";

export function getCronSecret(): string | undefined {
  const secret = process.env.CRON_SECRET?.trim();
  return secret && secret.length > 0 ? secret : undefined;
}

export function isCronAuthorized(request: NextRequest): boolean {
  const secret = getCronSecret();

  if (!secret) {
    logger.warn("cron_auth_skipped", { reason: "CRON_SECRET not configured" });
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return false;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return false;
  }

  return token === secret;
}
