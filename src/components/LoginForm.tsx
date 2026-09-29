"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/amplify";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    ensureAmplifyConfigured();

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      const result = await signIn({ username: email, password });
      if (result.isSignedIn) {
        router.replace("/invoices/unpaid");
        return;
      }
      setError("Sign-in incomplete. Check account confirmation.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-2 text-white disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
