BEGIN;

ALTER TABLE messages ALTER COLUMN content DROP NOT NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(10);
UPDATE messages SET message_type = 'text' WHERE message_type IS NULL;
ALTER TABLE messages ALTER COLUMN message_type SET DEFAULT 'text';
ALTER TABLE messages ALTER COLUMN message_type SET NOT NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_content_type_check'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_content_type_check CHECK (
        message_type IN ('text', 'image') AND (
          (message_type = 'text' AND content IS NOT NULL) OR
          (message_type = 'image' AND content IS NULL)
        )
      );
  END IF;
END $$;

COMMIT;
