"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dataClient, type Invoice } from "@/lib/data";
import { loadSessionUser, logout } from "@/lib/session";
import { primaryRole, type SessionUser } from "@/lib/permissions";

export function UnpaidInvoiceList() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadSessionUser();
      if (!session) {
        router.replace("/login");
        return;
      }
      if (cancelled) return;
      setUser(session);

      const { data, errors } = await dataClient().models.Invoice.list({
        filter: { status: { eq: "Unpaid" } },
      });
      if (cancelled) return;
      if (errors?.length) {
        setError(errors.map((e) => e.message).join("; "));
        return;
      }
      const rows = [...(data ?? [])].sort((a, b) =>
        (a.number ?? "").localeCompare(b.number ?? ""),
      );
      setInvoices(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSignOut() {
    await logout();
    router.replace("/login");
  }

  const role = primaryRole(user);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Unpaid invoices
          </h1>
          <p className="text-sm text-zinc-600">
            {user?.email}
            {role ? ` · ${role}` : ""}
            {user?.department ? ` · ${user.department}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
        >
          Sign out
        </button>
      </header>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <ul className="divide-y divide-zinc-200 border-y border-zinc-200">
        {invoices.map((invoice) => (
          <li key={invoice.id}>
            <Link
              href={`/invoices/${invoice.id}`}
              className="flex items-center justify-between gap-4 py-3 hover:bg-zinc-50"
            >
              <span>
                <span className="font-medium">{invoice.number}</span>
                <span className="ml-2 text-zinc-600">{invoice.supplier}</span>
                <span className="ml-2 text-zinc-500">{invoice.department}</span>
              </span>
              <span className="text-sm text-zinc-500">
                {invoice.assignedApproverName
                  ? `Approver: ${invoice.assignedApproverName}`
                  : "No approver assigned"}
              </span>
            </Link>
          </li>
        ))}
        {!error && invoices.length === 0 ? (
          <li className="py-6 text-sm text-zinc-500">No unpaid invoices.</li>
        ) : null}
      </ul>
    </main>
  );
}
