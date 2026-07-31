"use client";

import { Suspense, useEffect, useInsertionEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import NotificationToast from "../NotificationToast";
import Breadcrumbs from "../Breadcrumbs";
import MaintenanceBanner from "../MaintenanceBanner";
import CommandPalette from "../CommandPalette";
import NavigationProgress from "../NavigationProgress";
import Sidebar from "../Sidebar";
import {
  installDashboardCsrfFetch,
  prefetchDashboardCsrfToken,
} from "@/shared/utils/dashboardCsrf";
import { installBasePathFetch } from "@/shared/utils/basePathFetch";

const isE2EMode = process.env.NEXT_PUBLIC_OMNIROUTE_E2E_MODE === "1";

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);

  // Reset the main content scroll position on route change. The main container
  // is a reused element across client-side navigations, so without this the
  // scroll offset of the previous page would carry over (#scroll-reset).
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  useInsertionEffect(() => {
    const uninstallBasePathFetch = installBasePathFetch();
    const uninstallDashboardCsrfFetch = installDashboardCsrfFetch();
    void prefetchDashboardCsrfToken();
    return () => {
      uninstallDashboardCsrfFetch();
      uninstallBasePathFetch();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-[#f0f0f3]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-black focus:text-white focus:rounded-lg"
      >
        Skip to content
      </a>

      {/* Top Nav */}
      <header className="h-14 bg-white border-b border-[#e0e1e6] flex items-center px-4 sticky top-0 z-40">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="md:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Toggle menu"
        >
          <svg
            className="w-5 h-5 text-[#60646c]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 transition-colors mr-3"
          aria-label="Toggle sidebar"
        >
          <svg
            className={`w-4 h-4 text-[#60646c] transition-transform ${collapsed ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>
      </header>

      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Desktop sidebar — inline in flex layout */}
        <div className="hidden md:flex">
          <Sidebar
            collapsed={collapsed}
            onClose={() => setSidebarOpen(false)}
            onToggleCollapse={() => setCollapsed(!collapsed)}
          />
        </div>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div className="fixed inset-0 bg-black/20" onClick={() => setSidebarOpen(false)} />
            <div className="relative z-10">
              <Sidebar collapsed={false} onClose={() => setSidebarOpen(false)} />
            </div>
          </div>
        )}

        {/* Main Content */}
        <main id="main-content" ref={mainRef} className="flex-1 min-w-0 p-6 overflow-y-auto">
          <Suspense fallback={null}>
            <NavigationProgress />
          </Suspense>
          {!isE2EMode && <MaintenanceBanner />}
          <Breadcrumbs />
          {children}
        </main>
      </div>

      <NotificationToast />
      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
