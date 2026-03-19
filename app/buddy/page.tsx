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
      <div>
        <h1 className="text-xl font-bold">Buddies</h1>
        <p className="text-sm text-gray-500 mt-1">Track progress together with friends</p>
      </div>

      <Card title="Your buddies">
        {accepted.length === 0 ? (
          <p className="text-sm text-gray-400">No buddies yet. Add one below!</p>
        ) : (
          <ul className="space-y-2">
            {accepted.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                <span className="font-semibold text-gray-800">{b.username}</span>
                <form action={removeBuddy}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="text-xs text-gray-400 hover:text-red-500 transition-colors">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pendingIncoming.length > 0 && (
        <Card title="Incoming requests">
          <ul className="space-y-2">
            {pendingIncoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                <span className="font-semibold text-gray-800">{r.requester.username}</span>
                <div className="flex gap-2">
                  <form action={respondToBuddyRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="action" value="accept" />
                    <button className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 transition-colors">Accept</button>
                  </form>
                  <form action={respondToBuddyRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="action" value="decline" />
                    <button className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-500 transition-colors">Decline</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pendingSent.length > 0 && (
        <Card title="Sent requests">
          <ul className="space-y-2">
            {pendingSent.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                <span className="font-semibold text-gray-800">{r.addressee.username}</span>
                <span className="text-xs text-gray-400">Pending...</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Add a buddy">
        <form action={sendBuddyRequest} className="flex gap-2">
          <input
            name="username"
            placeholder="Username"
            className="flex-1 rounded-xl border-0 bg-gray-100 px-4 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500"
          />
          <button className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] transition-all">
            Send
          </button>
        </form>
      </Card>
    </div>
  );
}
