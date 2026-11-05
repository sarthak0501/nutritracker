import { authorizationMetadata, oauthErrorResponse, oauthJson } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export function GET() {
  try { return oauthJson(authorizationMetadata()); } catch (error) { return oauthErrorResponse(error); }
}
