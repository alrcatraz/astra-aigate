export * from "./types.ts";
export * from "./baseAgent.ts";
export * from "./registry.ts";
export * from "./db.ts";

import { createCloudAgentTaskTable } from "./db.ts";

// Best-effort table bootstrap (fire-and-forget). Route handlers also call and
// await createCloudAgentTaskTable(), so correctness doesn't depend on this.
createCloudAgentTaskTable().catch(() => {});
