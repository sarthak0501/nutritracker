import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getMcpConfig, MCP_SCOPE_DESCRIPTIONS, type McpScope } from "@/lib/oauth-config";
import { disconnectAssistant } from "./actions";
export const dynamic = "force-dynamic";
export default async function ConnectionsPage() {
  const session = await requireSession();
  const { enabled } = getMcpConfig();
  const connections = await prisma.oAuthConnection.findMany({ where: { userId: session.id, revokedAt: null, expiresAt: { gt: new Date() } }, include: { client: true }, orderBy: { createdAt: "desc" } }).catch((error: unknown) => {
    // A normal app deployment may precede the additive OAuth database rollout.
    if (!enabled && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") return [];
    throw error;
  });
  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
    <Link href="/" className="text-sm text-brand-600">Back to NutriTracker</Link>
    <h1 className="text-2xl font-bold">Connected assistants</h1>
    <p>Signed in as <strong>{session.username}</strong>. These assistants can use only your NutriTracker account.</p>
    {!enabled && <p>Assistant access is currently disabled. You can still disconnect any existing connections below.</p>}
    {enabled && !connections.length && <p>No assistants are connected. Start the connection from Claude and sign in with this NutriTracker account.</p>}
    {connections.map(connection => <section key={connection.id} className="space-y-3 rounded-2xl bg-surface-card p-5 shadow-card">
      <h2 className="font-bold">{connection.client.name}</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">{connection.scopes.map(scope => <li key={scope}>{MCP_SCOPE_DESCRIPTIONS[scope as McpScope] ?? scope}</li>)}</ul>
      <p className="text-sm text-gray-600">Connected {connection.createdAt.toISOString().slice(0, 10)} · Expires {connection.expiresAt.toISOString().slice(0, 10)}</p>
      <form action={disconnectAssistant}><input type="hidden" name="connectionId" value={connection.id} /><button className="rounded-xl border border-red-200 px-4 py-2 font-semibold text-red-700">Disconnect</button></form>
    </section>)}
    <p className="text-sm text-gray-500">Disconnecting stops future access immediately. It does not remove information already shared in your assistant chats.</p>
  </main>;
}
