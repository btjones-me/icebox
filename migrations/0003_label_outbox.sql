UPDATE sheet_outbox
SET payload_json = json_set(
      json_remove(payload_json, '$.caption'),
      '$.label', json_extract(payload_json, '$.caption'),
      '$.schema_version', 3
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE synced_at IS NULL
  AND json_type(payload_json, '$.caption') IS NOT NULL;

PRAGMA optimize;
