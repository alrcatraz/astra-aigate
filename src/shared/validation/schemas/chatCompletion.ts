import { z } from "zod";

/**
 * Schema for POST /api/v1/chat/completions body validation (t06 gate).
 *
 * Loose type gate: asserts JSON-object shape, `model` as a non-empty string, and
 * the documented discriminator (at least one of messages/input/prompt present as
 * the right kind of value). It intentionally does NOT constrain value contents —
 * streaming behaviour, model routing, message depth, and provider-specific fields
 * remain the responsibility of the downstream handlers (`admitChatStructure`,
 * `handleChat`, translators), which enforce them with richer context.
 *
 * `.catchall(z.unknown())` preserves pass-through of every provider-specific
 * extension field (temperature, tools, response_format, …) untouched — this route
 * is the OpenAI-compatible ingress and must not become a schema chokepoint.
 */
export const chatCompletionBodySchema = z
  .object({
    model: z.string().trim().min(1, "model is required").max(200),
    messages: z.array(z.unknown()).optional(),
    input: z.union([z.string().min(1), z.array(z.unknown()).min(1)]).optional(),
    prompt: z.string().min(1).optional(),
  })
  .catchall(z.unknown())
  .superRefine((value, ctx) => {
    if (value.messages === undefined && value.input === undefined && value.prompt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "messages, input or prompt is required",
        path: [],
      });
    }
    if (value.messages !== undefined && !Array.isArray(value.messages)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "messages must be an array",
        path: ["messages"],
      });
    }
  });
