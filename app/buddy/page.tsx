import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/Card";
import { WeeklyChallenge } from "@/components/WeeklyChallenge";
import { sendBuddyRequest, respondToBuddyRequest, removeBuddy } from "@/app/actions/buddy";
import { getChallengeData } from "@/lib/challenge";
import { todayIsoDate } from "@/lib/dates";

function AvatarBadge({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initial = (name ?? "?")[0].toUpperCase();
  const sizeClasses = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-white font-bold shadow-sm ${sizeClasses}`}
    >
      {initial}
    </div>
  );
}

export default async function BuddyPage() {
  const user = await requireSession();
  const today = todayIsoDate();

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
    ...sent
      .filter((r) => r.status === "ACCEPTED")
      .map((r) => ({ id: r.id, username: r.addressee.username, userId: r.addressee.id })),
    ...received
      .filter((r) => r.status === "ACCEPTED")
      .map((r) => ({ id: r.id, username: r.requester.username, userId: r.requester.id })),
  ];

  const pendingIncoming = received.filter((r) => r.status === "PENDING");
  const pendingSent = sent.filter((r) => r.status === "PENDING");

  // Fetch challenge data if there's an accepted buddy
  const buddy = accepted[0] ?? null;
  const challengeData = buddy
    ? await getChallengeData(user.id, buddy.userId)
    : null;

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-bold">Accountability Buddies</h1>
        <p className="text-sm text-gray-500 mt-1">Track together, stay motivated, celebrate wins</p>
      </div>

      {/* Weekly challenge — shown at top when buddy is connected */}
      {buddy && challengeData && (
        <Card variant="social" title="">
          <WeeklyChallenge
            myName={user.name}
            buddyName={buddy.username}
            currentWeek={challengeData.currentWeek}
            pastWeeks={challengeData.pastWeeks}
            todayIso={today}
          />
        </Card>
      )}

      {/* Accepted buddies */}
      <Card variant="social" title="Your buddies">
        {accepted.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-2">👥</div>
            <div className="text-sm font-medium text-gray-500">No buddies yet</div>
            <div className="text-xs text-gray-400 mt-1">
              Add a friend below to see each other's meals and cheer each other on
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {accepted.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-xl bg-white/70 px-4 py-3">
                <div className="flex items-center gap-3">
                  <AvatarBadge name={b.username} size="sm" />
                  <div>
                    <span className="font-semibold text-gray-800">{b.username}</span>
                    <div className="text-[10px] text-gray-400">Active buddy</div>
                  </div>
                </div>
                <form action={removeBuddy}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Incoming requests */}
      {pendingIncoming.length > 0 && (
        <Card title="Incoming requests">
          <ul className="space-y-2">
            {pendingIncoming.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <AvatarBadge name={r.requester.username} size="sm" />
                  <span className="font-semibold text-gray-800">{r.requester.username}</span>
                </div>
                <div className="flex gap-2">
                  <form action={respondToBuddyRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="action" value="accept" />
                    <button className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 transition-colors">
                      Accept
                    </button>
                  </form>
                  <form action={respondToBuddyRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="action" value="decline" />
                    <button className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-500 transition-colors">
                      Decline
                    </button>
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
              <li
                key={r.id}
                className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <AvatarBadge name={r.addressee.username} size="sm" />
                  <span className="font-semibold text-gray-800">{r.addressee.username}</span>
                </div>
                <span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-600">
                  Pending
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Add a buddy */}
      <Card title="Add a buddy">
        <form action={sendBuddyRequest} className="flex gap-2">
          <input
            name="username"
            placeholder="Enter their username"
            className="flex-1 rounded-xl border-0 bg-surface-muted px-4 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500"
          />
          <button className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] transition-all">
            Send
          </button>
        </form>
      </Card>
    </div>
  );
}
