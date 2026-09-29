/**
 * Reseed Cognito personas (from fixtures/personas.yaml) and fixture invoices.
 * Matches fixtures/runtime.yaml resetCommand: npm run db:seed
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { signIn, signOut } from "aws-amplify/auth";
import { load as loadYaml } from "js-yaml";
import type { Schema } from "../amplify/data/resource";

type PersonasFile = {
  personas: Record<
    string,
    { email: string; password: string; department?: string }
  >;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputsPath = resolve(root, "amplify_outputs.json");
const personasPath = resolve(
  root,
  "docs/requirements/invoice-approval/fixtures/personas.yaml"
);

if (!existsSync(outputsPath)) {
  console.error(
    "amplify_outputs.json missing. Run `npm run sandbox` first, then seed."
  );
  process.exit(1);
}

const outputs = JSON.parse(readFileSync(outputsPath, "utf8"));
const personasDoc = loadYaml(
  readFileSync(personasPath, "utf8")
) as PersonasFile;

const userPoolId = outputs.auth?.user_pool_id as string;
const region =
  (outputs.auth?.aws_region as string) ||
  process.env.AWS_REGION ||
  "ap-southeast-2";

if (!userPoolId || userPoolId.includes("REPLACE")) {
  console.error(
    "amplify_outputs.json has no real auth.user_pool_id. Run `npx ampx sandbox --once` first."
  );
  process.exit(1);
}

Amplify.configure(outputs);
const client = generateClient<Schema>();
const cognito = new CognitoIdentityProviderClient({ region });

const FINANCE = "Finance";
const OPERATIONS = "Operations";

/** Fixture manager only (not a personas.yaml login). Required by BR-003 / UC-003. */
const OPS_MANAGER = {
  email: "ops.manager@example.test",
  password: "test-only-not-production",
  displayName: "Operations Manager",
  department: OPERATIONS,
};

async function ensureUser(args: {
  email: string;
  password: string;
  group: "Admin" | "Manager" | "Viewer";
  department?: string;
}) {
  let exists = false;
  try {
    await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: args.email,
      })
    );
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: args.email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: args.email },
          { Name: "email_verified", Value: "true" },
          ...(args.department
            ? [{ Name: "custom:department", Value: args.department }]
            : []),
        ],
      })
    );
  }

  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: args.email,
      Password: args.password,
      Permanent: true,
    })
  );

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: args.email,
      GroupName: args.group,
    })
  );

  if (args.department) {
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: args.email,
        UserAttributes: [
          { Name: "custom:department", Value: args.department },
        ],
      })
    );
  }
}

async function clearModel(
  list: () => Promise<{ data: Array<{ id: string }> | null }>,
  remove: (id: string) => Promise<unknown>
) {
  const { data } = await list();
  for (const row of data ?? []) {
    await remove(row.id);
  }
}

async function main() {
  const admin = personasDoc.personas.Admin;
  const manager = personasDoc.personas.Manager;
  const viewer = personasDoc.personas.Viewer;

  if (!admin || !manager || !viewer) {
    throw new Error("personas.yaml must define Admin, Manager, Viewer");
  }

  console.log("Seeding Cognito users from personas.yaml…");
  await ensureUser({
    email: admin.email,
    password: admin.password,
    group: "Admin",
  });
  await ensureUser({
    email: manager.email,
    password: manager.password,
    group: "Manager",
    department: FINANCE,
  });
  await ensureUser({
    email: viewer.email,
    password: viewer.password,
    group: "Viewer",
  });
  await ensureUser({
    email: OPS_MANAGER.email,
    password: OPS_MANAGER.password,
    group: "Manager",
    department: OPERATIONS,
  });

  console.log("Signing in as Admin to seed Data…");
  try {
    await signOut();
  } catch {
    // no existing local Amplify session
  }
  await signIn({ username: admin.email, password: admin.password });

  await clearModel(
    async () => {
      const r = await client.models.Invoice.list();
      return { data: r.data ?? [] };
    },
    async (id) => client.models.Invoice.delete({ id })
  );
  await clearModel(
    async () => {
      const r = await client.models.ManagerProfile.list();
      return { data: r.data ?? [] };
    },
    async (id) => client.models.ManagerProfile.delete({ id })
  );

  await client.models.ManagerProfile.create({
    email: manager.email,
    displayName: "Finance Manager",
    department: FINANCE,
  });
  await client.models.ManagerProfile.create({
    email: OPS_MANAGER.email,
    displayName: OPS_MANAGER.displayName,
    department: OPERATIONS,
  });

  // UC-001 — unpaid Finance with Finance manager as assignedApprover
  await client.models.Invoice.create({
    number: "FIN-001",
    supplier: "Acme Supplies",
    department: FINANCE,
    status: "Unpaid",
    amount: 1200,
    assignedApproverEmail: manager.email,
    assignedApproverName: "Finance Manager",
  });

  // UC-003 / UC-005 — unpaid Finance, no assignedApprover
  await client.models.Invoice.create({
    number: "FIN-002",
    supplier: "Northwind Paper",
    department: FINANCE,
    status: "Unpaid",
    amount: 450,
  });

  // UC-004 — unpaid Operations invoice
  await client.models.Invoice.create({
    number: "OPS-001",
    supplier: "Field Services Co",
    department: OPERATIONS,
    status: "Unpaid",
    amount: 980,
  });

  await signOut();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
