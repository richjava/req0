import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { approveInvoice } from "../functions/approve-invoice/resource.ts";
import { assignApprover } from "../functions/assign-approver/resource.ts";

const schema = a
  .schema({
    InvoiceStatus: a.enum(["Unpaid", "Approved"]),

    ManagerProfile: a
      .model({
        email: a.email().required(),
        displayName: a.string().required(),
        department: a.string().required(),
      })
      .authorization((allow) => [
        allow.authenticated().to(["read"]),
        allow.groups(["Admin"]).to(["create", "update", "delete"]),
      ]),

    Invoice: a
      .model({
        number: a.string().required(),
        supplier: a.string().required(),
        department: a.string().required(),
        status: a.ref("InvoiceStatus").required(),
        amount: a.float(),
        assignedApproverEmail: a.email(),
        assignedApproverName: a.string(),
      })
      .authorization((allow) => [
        allow.authenticated().to(["read"]),
        allow.groups(["Admin"]).to(["create", "delete"]),
      ]),

    approveInvoice: a
      .mutation()
      .arguments({ invoiceId: a.id().required() })
      .returns(a.ref("Invoice"))
      .authorization((allow) => [allow.group("Manager")])
      .handler(a.handler.function(approveInvoice)),

    assignApprover: a
      .mutation()
      .arguments({
        invoiceId: a.id().required(),
        managerEmail: a.email().required(),
      })
      .returns(a.ref("Invoice"))
      .authorization((allow) => [allow.group("Admin")])
      .handler(a.handler.function(assignApprover)),
  })
  .authorization((allow) => [
    allow.resource(approveInvoice),
    allow.resource(assignApprover),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
