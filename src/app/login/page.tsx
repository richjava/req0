import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">
        Invoice approval
      </h1>
      <LoginForm />
    </main>
  );
}
