import { defineFunction } from "@aws-amplify/backend";

export const approveInvoice = defineFunction({
  name: "approve-invoice",
  entry: "./handler.ts",
});
