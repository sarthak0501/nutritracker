import { boundedBody, limitOAuthRequest, OAuthError, oauthErrorResponse, oauthJson, registerOAuthClient, requireMcpEnabled } from "@/lib/oauth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireMcpEnabled();
    await limitOAuthRequest(request, "register");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new OAuthError("invalid_request", "Use application/json.", 415);
    let body: unknown;
    try { body = JSON.parse(await boundedBody(request)); } catch (error) { if (error instanceof OAuthError) throw error; throw new OAuthError("invalid_client_metadata", "Invalid JSON."); }
    return oauthJson(await registerOAuthClient(body), 201);
  } catch (error) { return oauthErrorResponse(error); }
}
