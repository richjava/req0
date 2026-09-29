"use client";

import { fetchAuthSession, getCurrentUser, signOut } from "aws-amplify/auth";
import { ensureAmplifyConfigured } from "./amplify";
import type { Role, SessionUser } from "./permissions";

export async function loadSessionUser(): Promise<SessionUser | null> {
  ensureAmplifyConfigured();
  try {
    await getCurrentUser();
  } catch {
    return null;
  }

  const session = await fetchAuthSession();
  const payload = session.tokens?.idToken?.payload ?? {};
  const email = String(payload.email ?? "");
  const groups = normalizeGroups(payload["cognito:groups"]).filter(
    (g): g is Role => g === "Admin" || g === "Manager" || g === "Viewer"
  );
  const department = payload["custom:department"]
    ? String(payload["custom:department"])
    : null;

  return { email, groups, department };
}

export async function logout() {
  ensureAmplifyConfigured();
  await signOut();
}

function normalizeGroups(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value)
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}
