-- Migration 075: backfill self-service own-usage visibility for existing API keys.
--
-- This is intentionally a one-time compatibility update. After it has run,
-- operators may remove "self:usage" from a key and the absence of the scope
-- means self-service usage visibility is disabled.

CREATE TABLE IF NOT EXISTS key_value (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);

-- SQLite's JSON functions are dynamically typed: json_valid() returns 0/1,
-- json_type() returns a name and json_each() is table-valued. PostgreSQL has no
-- single equivalent, so each dialect keeps its own statement with identical
-- semantics (NULL → NULL, '' → invalid, valid-but-not-array → replaced).
-- @sqlite
UPDATE api_keys
SET scopes = json_array('self:usage')
WHERE NOT EXISTS (
    SELECT 1
    FROM key_value
    WHERE namespace = 'apiKeySelfService'
      AND key = 'usageScopesBackfilled'
  )
  AND (
    scopes IS NULL
    OR trim(scopes) = ''
    OR json_valid(scopes) = 0
    OR CASE
      WHEN json_valid(scopes) = 1 THEN json_type(scopes) != 'array'
      ELSE 0
    END
  );

UPDATE api_keys
SET scopes = json_insert(scopes, '$[#]', 'self:usage')
WHERE NOT EXISTS (
    SELECT 1
    FROM key_value
    WHERE namespace = 'apiKeySelfService'
      AND key = 'usageScopesBackfilled'
  )
  AND scopes IS NOT NULL
  AND trim(scopes) != ''
  AND json_valid(scopes) = 1
  AND json_type(scopes) = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(api_keys.scopes)
    WHERE value = 'self:usage'
  );
-- @end
-- @postgres
UPDATE api_keys
SET scopes = jsonb_build_array('self:usage')::text
WHERE NOT EXISTS (
    SELECT 1
    FROM key_value
    WHERE namespace = 'apiKeySelfService'
      AND key = 'usageScopesBackfilled'
  )
  AND (
    scopes IS NULL
    OR trim(scopes) = ''
    OR NOT pg_input_is_valid(scopes, 'jsonb')
    OR CASE
      WHEN pg_input_is_valid(scopes, 'jsonb') THEN jsonb_typeof(scopes::jsonb) <> 'array'
      ELSE false
    END
  );

UPDATE api_keys
SET scopes = (scopes::jsonb || to_jsonb('self:usage'::text))::text
WHERE NOT EXISTS (
    SELECT 1
    FROM key_value
    WHERE namespace = 'apiKeySelfService'
      AND key = 'usageScopesBackfilled'
  )
  AND scopes IS NOT NULL
  AND trim(scopes) <> ''
  AND pg_input_is_valid(scopes, 'jsonb')
  AND jsonb_typeof(scopes::jsonb) = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(scopes::jsonb) AS element(value)
    WHERE element.value = 'self:usage'
  );
-- @end

INSERT OR IGNORE INTO key_value (namespace, key, value)
VALUES ('apiKeySelfService', 'usageScopesBackfilled', datetime('now'));
