BEGIN;

ALTER TABLE review_queue
  ADD COLUMN IF NOT EXISTS resolution VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'review_queue'::regclass
      AND conname = 'review_queue_resolution_check'
  ) THEN
    ALTER TABLE review_queue
      ADD CONSTRAINT review_queue_resolution_check
      CHECK (resolution IS NULL OR resolution IN ('confirmed', 'dismissed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS review_queue_message_id_unique
  ON review_queue (message_id);

INSERT INTO review_queue (message_id, ai_score, status)
SELECT id, confidence_score, 'pending'
FROM messages
WHERE decision = 'warn'
ON CONFLICT (message_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enqueue_warned_message_for_review()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.decision = 'warn' THEN
    INSERT INTO review_queue (message_id, ai_score, status)
    VALUES (NEW.id, NEW.confidence_score, 'pending')
    ON CONFLICT (message_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_enqueue_review ON messages;
CREATE TRIGGER messages_enqueue_review
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION enqueue_warned_message_for_review();

COMMIT;
