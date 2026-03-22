import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/OnboardingWizard";

export default async function OnboardingPage() {
  const user = await requireSession();
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  if (profile?.onboardingCompleted) redirect("/");

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-surface to-accent-50 flex items-start justify-center pt-12 px-4 pb-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">NutriTracker</div>
          <div className="mt-1 text-sm text-gray-500">Let's get you set up — takes 60 seconds</div>
        </div>
        <div className="bg-surface-card rounded-2xl shadow-card p-6">
          <OnboardingWizard />
        </div>
      </div>
    </div>
  );
}
