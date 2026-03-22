import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-surface to-accent-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">NutriTracker</div>
          <div className="mt-2 text-sm text-gray-500">AI nutrition coach with buddy accountability</div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
