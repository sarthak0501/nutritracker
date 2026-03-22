import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-4xl font-extrabold tracking-tight text-brand-600">NutriTracker</div>
          <div className="mt-2 text-sm text-gray-500">AI nutrition coach with buddy accountability</div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
