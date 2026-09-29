import { defineStorage } from "@aws-amplify/backend";

/** Invoice document storage (S3). Required by recorded stack; unused by BR/UC flows. */
export const storage = defineStorage({
  name: "invoiceApprovalFiles",
  access: (allow) => ({
    "invoices/*": [
      allow.authenticated.to(["read"]),
      allow.groups(["Admin"]).to(["read", "write", "delete"]),
    ],
  }),
});
