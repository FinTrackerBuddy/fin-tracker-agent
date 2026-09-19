import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";

import {
  GOOGLE_SHEETS_LOCAL_REDIRECT_URI,
  createLocalGoogleOAuthAuthorizationPlan,
  parseLocalOAuthCallback,
} from "./local-oauth.js";
import {
  FileGoogleOAuthTokenStore,
  exchangeAuthorizationCode,
  getLocalGoogleOAuthPaths,
  loadInstalledGoogleOAuthCredentials,
  type GoogleOAuthPaths,
  type GoogleOAuthTokenStore,
  type InstalledGoogleOAuthCredentials,
} from "./oauth-token-store.js";

export interface GoogleAuthCommandDependencies {
  paths?: GoogleOAuthPaths;
  tokenStore?: GoogleOAuthTokenStore;
  openBrowser?: (url: URL) => Promise<boolean>;
  receiveCallback?: (redirectUri: string, state: string) => Promise<string>;
  exchangeCode?: (
    code: string,
    redirectUri: string,
    credentials: InstalledGoogleOAuthCredentials,
  ) => ReturnType<typeof exchangeAuthorizationCode>;
  log?: (message: string) => void;
}

/** Runs one local, read-only OAuth setup flow and stores the resulting tokens. */
export async function runGoogleAuthCommand(
  force: boolean,
  dependencies: GoogleAuthCommandDependencies = {},
): Promise<"authorized" | "reused"> {
  const paths = dependencies.paths ?? getLocalGoogleOAuthPaths();
  const credentials = await loadInstalledGoogleOAuthCredentials(paths.credentialsPath);
  const tokenStore = dependencies.tokenStore ?? new FileGoogleOAuthTokenStore(paths.tokenPath);
  const log = dependencies.log ?? console.log;

  if (!force) {
    try {
      if (await tokenStore.load()) {
        log("Google Sheets OAuth is already configured locally. Use npm run google-auth -- --force to reauthorize.");
        return "reused";
      }
    } catch {
      log("Saved Google OAuth token is invalid; starting reauthorization.");
    }
  }

  const redirectUri = GOOGLE_SHEETS_LOCAL_REDIRECT_URI;
  validateLocalRedirectUri(redirectUri);

  const state = randomUUID();
  const plan = createLocalGoogleOAuthAuthorizationPlan({
    authorizationEndpoint: credentials.auth_uri,
    clientId: credentials.client_id,
    redirectUri,
    state,
    reauthorize: force,
  });
  const receiveCallback = dependencies.receiveCallback ?? receiveLocalOAuthCallback;
  const callbackPromise = receiveCallback(redirectUri, state);
  const openBrowser = dependencies.openBrowser ?? openBrowserWhenPossible;
  const opened = await openBrowser(plan.authorizationUrl);
  if (!opened) {
    log(`Open this URL in a browser to authorize Google Sheets access:\n${plan.authorizationUrl.toString()}`);
  } else {
    log("Opened a browser for Google Sheets authorization. Select the account with workbook access.");
    log(`If the browser did not appear, open this URL:\n${plan.authorizationUrl.toString()}`);
  }

  const authorizationCode = await callbackPromise;
  const exchangeCode = dependencies.exchangeCode ?? exchangeAuthorizationCode;
  const tokens = await exchangeCode(authorizationCode, redirectUri, credentials);
  await tokenStore.save(tokens);
  log("Google Sheets OAuth authorization completed and was saved locally.");
  return "authorized";
}

async function receiveLocalOAuthCallback(
  redirectUri: string,
  state: string,
): Promise<string> {
  const redirect = new URL(redirectUri);
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const callback = new URL(request.url ?? "/", redirectUri);
        if (callback.pathname !== redirect.pathname) {
          throw new Error("Google OAuth callback used an unexpected path.");
        }
        const { code } = parseLocalOAuthCallback(callback, state);
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("Authentication complete. You may close this page.");
        server.close();
        resolve(code);
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("Authentication was not granted. You may close this page.");
        server.close();
        reject(error);
      }
    });
    server.once("error", reject);
    server.listen(Number(redirect.port || 80), redirect.hostname);
  });
}

async function openBrowserWhenPossible(url: URL): Promise<boolean> {
  const command = process.platform === "darwin"
    ? { executable: "open", args: [url.toString()] }
    : process.platform === "win32"
      ? { executable: "cmd", args: ["/c", "start", "", url.toString()] }
      : { executable: "xdg-open", args: [url.toString()] };
  return new Promise((resolve) => {
    try {
      const child = spawn(command.executable, command.args, {
        detached: true,
        stdio: "ignore",
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

function validateLocalRedirectUri(redirectUri: string): void {
  const redirect = new URL(redirectUri);
  if (redirect.hostname !== "localhost" || redirect.port !== "3000") {
    throw new Error("The local OAuth redirect URI must be http://localhost:3000/oauth2callback.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argumentsAfterNode = process.argv.slice(2);
  if (argumentsAfterNode.some((argument) => argument !== "--force")) {
    throw new Error("Usage: npm run google-auth [-- --force]");
  }
  await runGoogleAuthCommand(argumentsAfterNode.includes("--force"));
}
