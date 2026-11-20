"use client";

import { useEffect } from "react";
import { INSTALL_ON, startInstall } from "@/lib/installApp";

/** Mounted once in the root layout: makes the site installable as an app (see lib/installApp). */
export function AppShell() {
  useEffect(() => {
    if (INSTALL_ON) startInstall();
  }, []);
  return null;
}
