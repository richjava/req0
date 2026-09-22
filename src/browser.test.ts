import { describe, expect, it } from "vitest";
import { controlPendingName, optionMatches, pickOpenTarget } from "./browser.js";

const invoices = [
  { index: 0, name: "INV-FIN-001 Northwind Supplies · Finance Approver: Finance Manager" },
  { index: 1, name: "INV-FIN-002 Contoso Office · Finance No approver assigned" },
  { index: 2, name: "INV-OPS-001 Fabrikam Logistics · Operations Approver: Operations Manager" },
];

const tickets = [
  { index: 0, name: "TCK-1 Billing · Acme Assignee: Pat Lee" },
  { index: 1, name: "TCK-2 Billing · Acme No assignee" },
  { index: 2, name: "TCK-3 Support · North No assignee" },
];

describe("pickOpenTarget", () => {
  it("uses the invoice-named list as one pack fixture, not Req0 domain", () => {
    expect(
      pickOpenTarget(
        invoices,
        "Open the invoice",
        "The admin is logged in. An unpaid Finance invoice has no assignedApprover. A Finance manager and an Operations manager exist.",
      )?.name,
    ).toMatch(/INV-FIN-002/);
    expect(
      pickOpenTarget(
        invoices,
        "Open the Operations invoice",
        "The Manager persona (Finance) is logged in. An unpaid Operations invoice is visible.",
      )?.name,
    ).toMatch(/INV-OPS-001/);
    expect(
      pickOpenTarget(
        invoices,
        "Open the invoice",
        "The Manager persona (Finance) is logged in. An unpaid Finance invoice exists with this manager as assignedApprover.",
      )?.name,
    ).toMatch(/INV-FIN-001/);
  });

  it("picks by step + preconditions on a different domain list", () => {
    expect(
      pickOpenTarget(
        tickets,
        "Open the ticket",
        "The clerk is logged in. A billing ticket has no assignee. A support owner exists.",
      )?.name,
    ).toMatch(/TCK-2/);
    expect(
      pickOpenTarget(
        tickets,
        "Open the Support ticket",
        "The clerk is logged in. A support ticket is visible.",
      )?.name,
    ).toMatch(/TCK-3/);
  });

  it("does not treat a list Open as a record pick", () => {
    expect(pickOpenTarget(tickets, "Open the tickets list", "The clerk is logged in.")).toBeUndefined();
  });
});

describe("optionMatches", () => {
  it("matches Select labels by words, not a product field", () => {
    expect(optionMatches("Finance Manager (manager@example.test)", "Finance manager")).toBe(true);
    expect(optionMatches("Pat Lee (pat@example.test)", "Pat Lee")).toBe(true);
    expect(optionMatches("Operations Manager (ops-manager@example.test)", "Finance manager")).toBe(
      false,
    );
  });
});

describe("controlPendingName", () => {
  it("derives the in-progress button from the control label", () => {
    expect(controlPendingName("Approve")).toBe("Approving");
    expect(controlPendingName("Assign approver")).toBe("Assigning");
  });
});
