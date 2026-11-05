import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getMcpConfig } from "@/lib/oauth-config";
import { limitOAuthRequest, OAuthError, signConsent, validateAuthorizationRequest } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const config = getMcpConfig();
  if (!config.enabled) notFound();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  let authorization;
  try {
    await limitOAuthRequest(new Request(`${config.origin}/oauth/authorize`, { headers: await headers() }), "authorize");
    authorization = await validateAuthorizationRequest(params);
  } catch (error) {
    return <main className="mx-auto max-w-lg px-5 py-16"><h1 className="text-2xl font-bold">Unable to connect</h1><p className="mt-4">{error instanceof OAuthError ? error.message : "Please try connecting again from Claude."}</p></main>;
  }
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params}`)}`);
  const consent = await signConsent(session.id, authorization);
  return <main className="mx-auto max-w-lg space-y-6 px-5 py-12">
    <div><p className="font-semibold text-brand-600">NutriTracker</p><h1 className="mt-2 text-2xl font-bold">Connect {authorization.clientName}</h1></div>
    <p>Signed in as <strong>{session.username}</strong>. This connection can access only this NutriTracker account.</p>
    <div className="rounded-2xl bg-surface-card p-5 shadow-card"><h2 className="font-semibold">Allow this assistant to:</h2><ul className="mt-3 list-disc space-y-2 pl-5">
      {authorization.scopes.includes("nutrition:read") && <li>Read your account name, nutrition targets, meals, and progress.</li>}
      {authorization.scopes.includes("nutrition:write") && <li>Estimate and log meals, and undo meals recently saved through Claude.</li>}
    </ul></div>
    <p className="text-sm text-gray-600">You will return to <strong>{new URL(authorization.redirectUri).hostname}</strong>. The connection lasts up to 90 days. You can disconnect it at any time under Connected assistants.</p>
    <form action="/oauth/consent" method="post" className="space-y-3">
      <input type="hidden" name="consent" value={consent} />
      <button name="decision" value="allow" className="w-full rounded-xl bg-brand-600 p-3 font-semibold text-white">Allow connection</button>
      <button name="decision" value="deny" className="w-full rounded-xl border border-gray-300 p-3">Cancel</button>
      <button name="decision" value="switch" className="w-full p-2 text-sm text-brand-700">Use a different NutriTracker account</button>
    </form>
  </main>;
}
