import test from "node:test";
import assert from "node:assert/strict";

import { buildKiroPayload } from "../../open-sse/translator/request/openai-to-kiro.ts";

const body = { messages: [{ role: "user", content: "Hello" }] };

test("buildKiroPayload rejects removed or non-functional Kiro aliases", async () => {
  await assert.rejects(() => buildKiroPayload("auto-kiro", body, true, {}), /not a real Kiro/);
  await assert.rejects(
    () => buildKiroPayload("claude-sonnet-5-agentic", body, true, {}),
    /agentic aliases are not supported/
  );
  await assert.rejects(
    () => buildKiroPayload("claude-sonnet-4.5-thinking", body, true, {}),
    /does not support the '-thinking' alias/
  );
});
