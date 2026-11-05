import { formBody, limitOAuthRequest, oauthErrorResponse, oauthJson, requireMcpEnabled, revokeOAuthToken } from "@/lib/oauth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireMcpEnabled();
    await limitOAuthRequest(request, "revoke");
    await revokeOAuthToken(await formBody(request));
    return oauthJson({});
  } catch (error) { return oauthErrorResponse(error); }
}
