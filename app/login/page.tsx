import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold text-slate-900">🥗 NutriTracker</div>
          <div className="mt-2 text-sm text-slate-500">Sign in to continue</div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
