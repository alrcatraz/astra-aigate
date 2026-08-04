import CompressionHub from "./CompressionHub";

// `/dashboard/context` is the Compression Hub overview — the single place to
// understand and control compression (active profile selector + read-only
// preview). Previously this route redirected to `/dashboard/context/settings`
// (upstream `?tab=` legacy), which made the sidebar "Context" entry land on the
// Compression Settings page and left the actual Hub buried at the top of the
// Combos page. The Hub component lives here now; `/dashboard/context/combos`
// is purely named-combo management.
export default function ContextPage() {
  return <CompressionHub />;
}
