import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/Card";
import { sendBuddyRequest, respondToBuddyRequest, removeBuddy } from "@/app/actions/buddy";

export default async function BuddyPage() {
  const user = await requireSession();

  const [sent, received] = await Promise.all([
    prisma.buddyRelationship.findMany({
      where: { requesterId: user.id },
      include: { addressee: { select: { id: true, username: true } } },
    }),
    prisma.buddyRelationship.findMany({
      where: { addresseeId: user.id },
      include: { requester: { select: { id: true, username: true } } },
    }),
  ]);

  const accepted = [
    ...sent.filter((r) => r.status === "ACCEPTED").map((r) => ({ id: r.id, username: r.addressee.username })),
    ...received.filter((r) => r.status === "ACCEPTED").map((r) => ({ id: r.id, username: r.requester.username })),
  ];

  const pendingIncoming = received.filter((r) => r.status === "PENDING");
  const pendingSent = sent.filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">🤝 Buddies</h1>

      {/* Current buddies */}
      <Card title="Your buddies">
        {accepted.length === 0 ? (
          <p className="text-sm text-zinc-400">No buddies yet.</p>
        ) : (
          <ul className="space-y-2">
            {accepted.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                <span className="font-medium">{b.username}</span>
                <form action={removeBuddy}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="text-xs text-zinc-500 hover:text-red-400">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Incoming requests */}
      {pendingIncoming.length > 0 && (
        <Card title="Incoming buddy requests">
          <ul className="space-y-2">
            {pendingIncoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                <span className="font-medium">{r.requester.username}</span>
                <div className="flex gap-2">
                  <form action={respondToBuddyRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="action" value="accept" />
                    <button className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-950 hover:bg-white">Accept</button>
                  </form>
                  <form action={respondToBuddyRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="action" value="decline" />
                    <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-red-400">Decline</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Sent requests */}
      {pendingSent.length > 0 && (
        <Card title="Sent requests">
          <ul className="space-y-2">
            {pendingSent.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                <span className="font-medium">{r.addressee.username}</span>
                <span className="text-xs text-zinc-500">Pending…</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Add buddy */}
      <Card title="Add a buddy">
        <form action={sendBuddyRequest} className="flex gap-2">
          <input
            name="username"
            placeholder="Username"
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-sm"
          />
          <button className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white">
            Send request
          </button>
        </form>
      </Card>
    </div>
  );
}
