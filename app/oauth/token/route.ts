import { exchangeOAuthToken, formBody, limitOAuthRequest, oauthErrorResponse, oauthJson, requireMcpEnabled } from "@/lib/oauth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireMcpEnabled();
    await limitOAuthRequest(request, "token");
    return oauthJson(await exchangeOAuthToken(await formBody(request)));
  } catch (error) { return oauthErrorResponse(error); }
}
