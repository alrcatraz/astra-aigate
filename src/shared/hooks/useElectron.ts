"use client";

import { useCallback } from "react";

/**
 * Open an external URL — via the OS shell when running inside a desktop shell
 * that exposes `window.electronAPI`, otherwise a new browser tab.
 * Single source of truth for external links.
 */
export function useOpenExternal() {
  const openExternal = useCallback(async (url: string) => {
     
    const api = (globalThis.window as any)?.electronAPI;
    if (api?.isElectron && typeof api.openExternal === "function") {
      await api.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  return { openExternal };
}
