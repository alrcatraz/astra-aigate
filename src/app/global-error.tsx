"use client";

/**
 * Global Error Page — FASE-04 Error Handling
 *
 * Root-level error boundary for unrecoverable errors.
 * This is the last resort — catches errors that the per-page
 * error.js boundaries don't handle.
 */

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    // lang="en" is intentional: global-error is a client-side root boundary that
    // renders ABOVE the next-intl provider, so the active locale isn't reliably
    // available here. Its visible text is static English, so lang="en" stays
    // consistent with the content. User-facing locale is handled by the normal
    // layout (<html lang={locale}> in src/app/layout.tsx).
    <html lang="en">
      <body className="flex flex-col items-center justify-center min-h-screen p-6 bg-[#f0f0f3] text-[#000000] font-sans text-center m-0">
        <main role="alert" aria-live="assertive" className="flex flex-col items-center">
          <div className="text-[64px] mb-4" aria-hidden="true">
            ⚠️
          </div>
          <h1 className="text-[28px] font-bold mb-2">Something went wrong</h1>
          <p className="text-[15px] text-[#60646c] max-w-[400px] leading-relaxed mb-6">
            An unexpected error occurred. This has been logged and our team will investigate.
          </p>
          {process.env.NODE_ENV === "development" && error?.message && (
            <pre
              className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs max-w-[600px] overflow-auto text-left mb-6"
              aria-label="Error details"
            >
              {error.message}
            </pre>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={reset}
              aria-label="Retry loading the page"
              className="px-8 py-3 rounded-full text-white border-none text-sm font-semibold cursor-pointer bg-[#000000] hover:bg-[#333333] transition-colors focus:outline-2 focus:outline-offset-2 focus:outline-[#000000]"
            >
              Try Again
            </button>
            <a
              href="/status"
              aria-label="Open system status"
              className="px-8 py-3 rounded-full text-sm font-semibold border border-[#e0e1e6] hover:bg-gray-50 no-underline text-[#000000] focus:outline-2 focus:outline-offset-2 focus:outline-[#000000]"
            >
              System Status
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
