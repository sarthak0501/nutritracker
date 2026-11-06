import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getMcpConfig, MCP_OPTIONAL_CAPABILITIES, MCP_SCOPE_DESCRIPTIONS, optionalConsentScopes, type McpScope } from "@/lib/oauth-config";
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
    return <main className="mx-auto max-w-lg px-5 py-16"><h1 className="text-2xl font-bold">Unable to connect</h1><p className="mt-4">{error instanceof OAuthError ? error.message : "Please try connecting again from your assistant."}</p></main>;
  }
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params}`)}`);
  const offeredScopes = optionalConsentScopes(authorization.scopes);
  const consent = await signConsent(session.id, authorization, offeredScopes);
  return <main className="mx-auto max-w-lg space-y-6 px-5 py-12">
    <div><p className="font-semibold text-brand-600">NutriTracker</p><h1 className="mt-2 text-2xl font-bold">Connect {authorization.clientName}</h1></div>
    <p>Signed in as <strong>{session.username}</strong>. This connection uses your NutriTracker account and the permissions you approve below.</p>
    <div className="rounded-2xl bg-surface-card p-5 shadow-card"><h2 className="font-semibold">Allow this assistant to:</h2><ul className="mt-3 list-disc space-y-2 pl-5">
      {authorization.scopes.map(scope => <li key={scope}>{MCP_SCOPE_DESCRIPTIONS[scope as McpScope]}</li>)}
    </ul></div>
    <p className="text-sm text-gray-600">You will return to <strong>{new URL(authorization.redirectUri).hostname}</strong>. The connection lasts up to 90 days. You can disconnect it at any time under Connected assistants.</p>
    <form action="/oauth/consent" method="post" className="space-y-3">
      <input type="hidden" name="consent" value={consent} />
      {offeredScopes.length > 0 && <fieldset className="space-y-4 rounded-2xl border border-gray-300 p-5">
        <legend className="px-1 font-semibold">Optional additional features</legend>
        <p className="text-sm text-gray-600">Choose the features you want this assistant to use. Leaving a box unchecked keeps that additional access off.</p>
        {MCP_OPTIONAL_CAPABILITIES.map(group => {
          const scopes = group.scopes.filter(scope => offeredScopes.includes(scope));
          return scopes.length > 0 && <label key={group.key} className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" name={`allow_${group.key}`} value="yes" className="mt-1 h-5 w-5 shrink-0" />
            <span><span className="font-semibold">{group.label}</span><span className="mt-1 block text-sm text-gray-600">{scopes.map(scope => MCP_SCOPE_DESCRIPTIONS[scope]).join(" ")}</span></span>
          </label>;
        })}
      </fieldset>}
      <button name="decision" value="allow" className="w-full rounded-xl bg-brand-600 p-3 font-semibold text-white">Allow connection</button>
      <button name="decision" value="deny" className="w-full rounded-xl border border-gray-300 p-3">Cancel</button>
      <button name="decision" value="switch" className="w-full p-2 text-sm text-brand-700">Use a different NutriTracker account</button>
    </form>
  </main>;
}
