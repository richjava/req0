"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dataClient, type Invoice, type ManagerProfile } from "@/lib/data";
import { loadSessionUser } from "@/lib/session";
import {
  canAssignApprover,
  canShowApprove,
  primaryRole,
  type SessionUser,
} from "@/lib/permissions";

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [managers, setManagers] = useState<ManagerProfile[]>([]);
  const [selectedManager, setSelectedManager] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [{ data, errors }, managersResult] = await Promise.all([
      dataClient().models.Invoice.get({ id: invoiceId }),
      dataClient().models.ManagerProfile.list(),
    ]);
    if (errors?.length || !data) {
      setError(errors?.map((e) => e.message).join("; ") ?? "Not found");
      setInvoice(null);
      setManagers([]);
      return;
    }
    setManagers(managersResult.data ?? []);
    setInvoice(data);
    setError(null);
  }

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
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, router]);

  const role = primaryRole(user);

  const eligibleManagers = useMemo(() => {
    if (!invoice) return [];
    return managers.filter((m) => m.department === invoice.department);
  }, [managers, invoice]);

  const approveEnabled =
    !!user &&
    !!invoice &&
    canShowApprove({
      role,
      userEmail: user.email,
      userDepartment: user.department,
      invoiceDepartment: invoice.department,
      invoiceStatus: invoice.status ?? "Unpaid",
      assignedApproverEmail: invoice.assignedApproverEmail,
    });

  const assignEnabled =
    !!invoice && canAssignApprover(role, invoice.status ?? "Unpaid");

  async function onApprove() {
    if (!invoice || !approveEnabled) return;
    setBusy(true);
    setError(null);
    try {
      const { data, errors } = await dataClient().mutations.approveInvoice({
        invoiceId: invoice.id,
      });
      if (errors?.length || !data) {
        setError(errors?.map((e) => e.message).join("; ") ?? "Approve failed");
      } else {
        setInvoice(data as Invoice);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAssign() {
    if (!invoice || !assignEnabled || !selectedManager) return;
    setBusy(true);
    setError(null);
    try {
      const { data, errors } = await dataClient().mutations.assignApprover({
        invoiceId: invoice.id,
        managerEmail: selectedManager,
      });
      if (errors?.length || !data) {
        setError(errors?.map((e) => e.message).join("; ") ?? "Assign failed");
      } else {
        setInvoice(data as Invoice);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  if (!invoice && !error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 text-sm text-zinc-500">
        Loading…
      </main>
    );
  }

  const assignedLabel = invoice?.assignedApproverName
    ? invoice.assignedApproverName
    : invoice?.assignedApproverEmail
      ? invoice.assignedApproverEmail
      : "none";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-4 text-sm">
        <Link href="/invoices/unpaid" className="text-zinc-600 underline">
          Unpaid invoices
        </Link>
      </p>

      {invoice ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {invoice.number}
          </h1>
          <p className="mt-1 text-zinc-600">
            {invoice.supplier} · {invoice.department}
          </p>

          <dl className="mt-6 space-y-3 text-sm">
            <div>
              <dt className="font-medium text-zinc-500">Status</dt>
              <dd id="status-label" data-testid="status-label">
                {invoice.status}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">Assigned approver</dt>
              <dd id="assigned-approver-label" data-testid="assigned-approver-label">
                {assignedLabel}
              </dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-col gap-4">
            {approveEnabled ? (
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                className="w-fit rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
              >
                Approve
              </button>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="w-fit rounded bg-zinc-200 px-4 py-2 text-zinc-500"
              >
                Approve
              </button>
            )}

            {assignEnabled ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  Manager
                  <select
                    id="manager-select"
                    data-testid="manager-select"
                    value={selectedManager}
                    onChange={(e) => setSelectedManager(e.target.value)}
                    className="rounded border border-zinc-300 px-3 py-2"
                  >
                    <option value="">Select manager…</option>
                    {eligibleManagers.map((m) => (
                      <option key={m.id} value={m.email}>
                        {m.displayName} ({m.email})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={onAssign}
                  disabled={busy || !selectedManager}
                  className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
                >
                  Assign approver
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
    </main>
  );
}
