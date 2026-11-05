import { deleteSession, getSession } from "@/lib/auth-session";
import { approveConsent, authorizationRedirect, formBody, limitOAuthRequest, OAuthError, oauthErrorResponse, readConsent, requireMcpEnabled, selectedConsentScopes } from "@/lib/oauth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const config = requireMcpEnabled();
    if (request.headers.get("origin") !== config.origin) throw new OAuthError("invalid_request", "The consent request must come from NutriTracker.", 403);
    await limitOAuthRequest(request, "consent");
    const session = await getSession();
    if (!session) throw new OAuthError("access_denied", "Sign in to NutriTracker and start the connection again.", 401);
    const form = await formBody(request);
    const signedConsent = form.get("consent") ?? "";
    const { request: authorization, offeredScopes } = await readConsent(signedConsent, session.id);
    const decision = form.get("decision");
    if (decision === "switch") {
      await deleteSession();
      const params = new URLSearchParams({ client_id: authorization.clientId, redirect_uri: authorization.redirectUri, response_type: "code", resource: authorization.resource, code_challenge: authorization.codeChallenge, code_challenge_method: "S256", scope: authorization.scopes.join(" ") });
      if (authorization.state !== null) params.set("state", authorization.state);
      return Response.redirect(`${config.origin}/login?next=${encodeURIComponent(`/oauth/authorize?${params}`)}`, 303);
    }
    if (decision !== "allow" && decision !== "deny") throw new OAuthError("invalid_request", "Choose Allow connection or Cancel.");
    const location = decision === "allow" ? await approveConsent(session.id, signedConsent, selectedConsentScopes(form, offeredScopes)) : authorizationRedirect(authorization, { error: "access_denied", error_description: "The user declined the connection." });
    return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return oauthErrorResponse(error); }
}
