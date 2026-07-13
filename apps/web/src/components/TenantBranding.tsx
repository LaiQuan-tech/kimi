"use client";

import { useEffect } from "react";
import { getBranding } from "@/lib/ess-api";

export function TenantBranding() {
  useEffect(() => {
    let active = true;
    getBranding()
      .then((res) => {
        if (!active) return;
        const primaryColor = res.branding?.primaryColor;
        const appName = res.branding?.appName;
        if (primaryColor) {
          document.documentElement.style.setProperty("--brand", primaryColor);
        }
        if (appName) {
          document.title = appName;
        }
      })
      .catch(() => {
        /* Unauthenticated pages keep the default brand. */
      });
    return () => {
      active = false;
    };
  }, []);

  return null;
}
