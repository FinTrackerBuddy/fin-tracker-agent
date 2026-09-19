import { timingSafeEqual } from "node:crypto";

/** Loads the required static token without exposing its value. */
export function loadApiAuthToken(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const token = environment.API_AUTH_TOKEN?.trim();
  if (!token) {
    throw new Error("API_AUTH_TOKEN must be set.");
  }
  return token;
}

/** Verifies only a strict `Authorization: Bearer <token>` header. */
export function isAuthorizedBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    return false;
  }

  const suppliedToken = Buffer.from(match[1]!, "utf8");
  const configuredToken = Buffer.from(expectedToken, "utf8");
  if (suppliedToken.length !== configuredToken.length) {
    return false;
  }
  return timingSafeEqual(suppliedToken, configuredToken);
}
