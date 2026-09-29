import { defineFunction } from "@aws-amplify/backend";

export const assignApprover = defineFunction({
  name: "assign-approver",
  entry: "./handler.ts",
});
