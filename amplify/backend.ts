import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.ts";
import { data } from "./data/resource.ts";
import { storage } from "./storage/resource.ts";
import { approveInvoice } from "./functions/approve-invoice/resource.ts";
import { assignApprover } from "./functions/assign-approver/resource.ts";

const backend = defineBackend({
  auth,
  data,
  storage,
  approveInvoice,
  assignApprover,
});

// Allow fixtures/personas.yaml passwords (test-only).
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: true,
    requireNumbers: false,
    requireSymbols: false,
    requireUppercase: false,
    temporaryPasswordValidityDays: 7,
  },
};
