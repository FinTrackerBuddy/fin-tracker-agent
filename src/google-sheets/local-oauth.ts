export const GOOGLE_SHEETS_READ_ONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

/** The fixed local callback used by the one-time desktop OAuth setup command. */
export const GOOGLE_SHEETS_LOCAL_REDIRECT_URI =
  "http://localhost:3000/oauth2callback";

export interface LocalGoogleOAuthAuthorizationInput {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  /** True only when the user intentionally starts a fresh authorization flow. */
  reauthorize?: boolean;
}

export interface LocalGoogleOAuthAuthorizationPlan {
  authorizationUrl: URL;
  reuseSavedToken: boolean;
}

/**
 * Builds the local, read-only Google Sheets authorization request.
 *
 * `prompt=select_account` makes Google show its account chooser whenever this
 * URL is opened. A deliberate reauthorization also disables reuse of a saved
 * token, so callers must send the user through this URL first.
 */
export function createLocalGoogleOAuthAuthorizationPlan(
  input: LocalGoogleOAuthAuthorizationInput,
): LocalGoogleOAuthAuthorizationPlan {
  const authorizationUrl = new URL(input.authorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SHEETS_READ_ONLY_SCOPE,
    state: input.state,
    access_type: "offline",
    prompt: "select_account",
  }).toString();

  return {
    authorizationUrl,
    reuseSavedToken: !input.reauthorize,
  };
}

export interface LocalOAuthCallbackResult {
  code: string;
}

/** Validates the callback query before a caller exchanges the authorization code. */
export function parseLocalOAuthCallback(
  callbackUrl: URL,
  expectedState: string,
): LocalOAuthCallbackResult {
  const error = callbackUrl.searchParams.get("error");
  if (error) {
    throw new Error(`Google OAuth authorization failed: ${error}.`);
  }
  if (callbackUrl.searchParams.get("state") !== expectedState) {
    throw new Error("Google OAuth callback state did not match the authorization request.");
  }
  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error("Google OAuth callback did not include an authorization code.");
  }
  return { code };
}
