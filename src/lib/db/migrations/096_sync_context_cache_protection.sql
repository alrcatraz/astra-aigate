-- 096_sync_context_cache_protection.sql
-- Sync the context_cache_protection column with the JSON blob for existing combos.
-- Before this migration, the column was never written by the API, so existing rows
-- have 0 (from ADD COLUMN DEFAULT 0) even when the JSON blob has it set to true.
-- This migration brings them in sync so the column becomes the authoritative source.
--
-- SQLite's json_extract() maps JSON true to 1 and never matches the string "1";
-- PostgreSQL keeps them as distinct jsonb values, so the check names both.
-- @sqlite
UPDATE combos
SET context_cache_protection = 1
WHERE json_extract(data, '$.context_cache_protection') = 1
  AND (context_cache_protection IS NULL OR context_cache_protection = 0);
-- @end
-- @postgres
UPDATE combos
SET context_cache_protection = 1
WHERE pg_input_is_valid(data, 'jsonb')
  AND (data::jsonb)->'context_cache_protection' IN ('1'::jsonb, 'true'::jsonb)
  AND (context_cache_protection IS NULL OR context_cache_protection = 0);
-- @end
