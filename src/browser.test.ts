import { describe, expect, it } from "vitest";
import { optionMatches, pickInvoice } from "./browser.js";

const list = [
  { index: 0, name: "INV-FIN-001 Northwind Supplies · Finance Approver: Finance Manager" },
  { index: 1, name: "INV-FIN-002 Contoso Office · Finance No approver assigned" },
  { index: 2, name: "INV-OPS-001 Fabrikam Logistics · Operations Approver: Operations Manager" },
];

describe("pickInvoice", () => {
  it("opens the unassigned Finance invoice for UC-003, not Operations because an Operations manager exists", () => {
    const hay =
      "open the invoice\nthe admin is logged in. an unpaid finance invoice has no assignedapprover. a finance manager and an operations manager exist.";
    expect(pickInvoice(list, hay)?.name).toMatch(/INV-FIN-002/);
  });

  it("opens the Operations invoice when the step says so", () => {
    const hay =
      "open the operations invoice\nthe manager persona (finance) is logged in. an unpaid operations invoice is visible.";
    expect(pickInvoice(list, hay)?.name).toMatch(/INV-OPS-001/);
  });

  it("opens the assigned Finance invoice for UC-001", () => {
    const hay =
      "open the invoice\nthe manager persona (finance) is logged in. an unpaid finance invoice exists with this manager as assignedapprover.";
    expect(pickInvoice(list, hay)?.name).toMatch(/INV-FIN-001/);
  });
});

describe("optionMatches", () => {
  it("matches Select the Finance manager to the seeded option label", () => {
    expect(optionMatches("Finance Manager (manager@example.test)", "Finance manager")).toBe(true);
    expect(optionMatches("Operations Manager (ops-manager@example.test)", "Finance manager")).toBe(
      false,
    );
  });
});
