import { protectedResourceMetadata, oauthErrorResponse, oauthJson } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export function GET() {
  try { return oauthJson(protectedResourceMetadata()); } catch (error) { return oauthErrorResponse(error); }
}
