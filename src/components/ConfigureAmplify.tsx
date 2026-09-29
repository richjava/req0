"use client";

import { useEffect } from "react";
import { ensureAmplifyConfigured } from "@/lib/amplify";

export function ConfigureAmplify({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    ensureAmplifyConfigured();
  }, []);
  return <>{children}</>;
}
