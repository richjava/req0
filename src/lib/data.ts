"use client";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { ensureAmplifyConfigured } from "./amplify";

let client: ReturnType<typeof generateClient<Schema>> | null = null;

export function dataClient() {
  ensureAmplifyConfigured();
  if (!client) {
    client = generateClient<Schema>();
  }
  return client;
}

export type Invoice = Schema["Invoice"]["type"];
export type ManagerProfile = Schema["ManagerProfile"]["type"];
