import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../data/resource.ts";
import { env } from "$amplify/env/assign-approver";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

type CognitoIdentity = {
  claims?: Record<string, string | string[] | undefined>;
};

/**
 * BR-003 — Admin may assign asApprover only a manager whose department
 * equals the invoice's department.
 */
export const handler: Schema["assignApprover"]["functionHandler"] = async (
  event
) => {
  const identity = event.identity as CognitoIdentity | undefined;
  const claims = identity?.claims ?? {};
  const groups = normalizeGroups(claims["cognito:groups"]);

  if (!groups.includes("Admin")) {
    throw new Error("Assign denied: Admin role required");
  }

  const { invoiceId, managerEmail } = event.arguments;

  const { data: invoice, errors } = await client.models.Invoice.get({
    id: invoiceId,
  });
  if (errors?.length || !invoice) {
    throw new Error("Invoice not found");
  }

  const { data: managers } = await client.models.ManagerProfile.list({
    filter: { email: { eq: managerEmail } },
  });
  const manager = managers?.[0];
  if (!manager) {
    throw new Error("Assign denied: manager not found");
  }

  // BR-003 — same department only
  if (manager.department !== invoice.department) {
    throw new Error(
      "Assign denied: manager department must equal invoice department"
    );
  }

  const { data: updated, errors: updateErrors } =
    await client.models.Invoice.update({
      id: invoiceId,
      assignedApproverEmail: manager.email,
      assignedApproverName: manager.displayName,
    });

  if (updateErrors?.length || !updated) {
    throw new Error("Assign failed");
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
