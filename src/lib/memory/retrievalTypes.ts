/**
 * Retrieval types exposed publicly (§3.6), extracted from retrieval.ts.
 */

import type { Memory, MemoryConfig } from "./types";

export interface RetrievalOptions extends Partial<MemoryConfig> {
  query?: string;
  sessionId?: string;
}

// ──────────────── Types exposed publicly (§3.6) ────────────────

export interface RetrievePreviewItem {
  memory: Memory;
  score: number;
  tokens: number;
  tier: "fts5" | "vector" | "hybrid-rrf" | "qdrant";
  vecScore: number | null;
  ftsScore: number | null;
}

export interface RetrievePreviewResolution {
  embeddingSource: "remote" | "static" | "transformers" | null;
  embeddingModel: string | null;
  vectorStore: "sqlite-vec" | "qdrant" | "none";
  strategyUsed: "exact" | "semantic" | "hybrid";
  rerankApplied: boolean;
  fallbackReason: string | null;
}

export interface RetrievePreviewBundle {
  items: RetrievePreviewItem[];
  resolution: RetrievePreviewResolution;
  totalTokens: number;
  budgetMaxTokens: number;
}
