import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../data/resource.ts";
import { env } from "$amplify/env/approve-invoice";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

type CognitoIdentity = {
  claims?: Record<string, string | string[] | undefined>;
};

/**
 * BR-001 / BR-004 / BR-005 — Manager may approve only when they are the
 * assignedApprover and the invoice department matches theirs.
 */
export const handler: Schema["approveInvoice"]["functionHandler"] = async (
  event
) => {
  const identity = event.identity as CognitoIdentity | undefined;
  const claims = identity?.claims ?? {};
  const groups = normalizeGroups(claims["cognito:groups"]);
  const email = String(claims.email ?? "");
  const department = String(claims["custom:department"] ?? "");

  if (!groups.includes("Manager")) {
    throw new Error("Approve denied: Manager role required");
  }

  const invoiceId = event.arguments.invoiceId;
  const { data: invoice, errors } = await client.models.Invoice.get({
    id: invoiceId,
  });
  if (errors?.length || !invoice) {
    throw new Error("Invoice not found");
  }

  if (invoice.status !== "Unpaid") {
    throw new Error("Approve denied: invoice is not Unpaid");
  }

  // BR-004 — department must match
  if (!department || invoice.department !== department) {
    throw new Error("Approve denied: invoice is not in manager department");
  }

  // BR-005 / BR-001 — must be assignedApprover
  if (
    !invoice.assignedApproverEmail ||
    invoice.assignedApproverEmail.toLowerCase() !== email.toLowerCase()
  ) {
    throw new Error("Approve denied: not the assignedApprover");
  }

  const { data: updated, errors: updateErrors } =
    await client.models.Invoice.update({
      id: invoiceId,
      status: "Approved",
    });

  if (updateErrors?.length || !updated) {
    throw new Error("Approve failed");
  }

  return updated;
};

function normalizeGroups(
  value: string | string[] | undefined
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value)
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}
