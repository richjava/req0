export type Role = "Admin" | "Manager" | "Viewer";

export type SessionUser = {
  email: string;
  groups: Role[];
  department: string | null;
};

export function primaryRole(user: SessionUser | null): Role | null {
  if (!user?.groups.length) return null;
  if (user.groups.includes("Admin")) return "Admin";
  if (user.groups.includes("Manager")) return "Manager";
  if (user.groups.includes("Viewer")) return "Viewer";
  return null;
}

/** Matrix: Approve — Manager allow; Admin/Viewer deny. BR-001/004/005 gate UI. */
export function canShowApprove(args: {
  role: Role | null;
  userEmail: string;
  userDepartment: string | null;
  invoiceDepartment: string;
  invoiceStatus: string;
  assignedApproverEmail: string | null | undefined;
}): boolean {
  if (args.role !== "Manager") return false;
  if (args.invoiceStatus !== "Unpaid") return false;
  if (!args.userDepartment || args.invoiceDepartment !== args.userDepartment) {
    return false;
  }
  if (
    !args.assignedApproverEmail ||
    args.assignedApproverEmail.toLowerCase() !== args.userEmail.toLowerCase()
  ) {
    return false;
  }
  return true;
}

/** Matrix: Assign-approver — Admin allow only. */
export function canAssignApprover(role: Role | null, status: string): boolean {
  return role === "Admin" && status === "Unpaid";
}
