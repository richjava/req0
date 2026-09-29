"use client";

import { Amplify } from "aws-amplify";
import outputs from "../../amplify_outputs.json";

let configured = false;

export function ensureAmplifyConfigured() {
  if (configured) return;
  Amplify.configure(outputs, { ssr: true });
  configured = true;
}
