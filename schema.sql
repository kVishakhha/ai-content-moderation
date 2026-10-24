-- Create database (run this separately if needed)
-- CREATE DATABASE ai_moderation;

-- Connect to ai_moderation database then run the rest

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  content TEXT,
  message_type VARCHAR(10) NOT NULL DEFAULT 'text',
  image_url TEXT,
  mime_type VARCHAR(100),
  decision VARCHAR(10) DEFAULT 'pending',
  confidence_score FLOAT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT messages_content_type_check CHECK (
    message_type IN ('text', 'image') AND
    (
      (message_type = 'text' AND content IS NOT NULL AND mime_type IS NULL) OR
      (message_type = 'image' AND mime_type IS NOT NULL)
    )
  )
);

-- Warning messages are added to this queue by the trigger below.
CREATE TABLE IF NOT EXISTS review_queue (
  id SERIAL PRIMARY KEY,
  message_id INTEGER UNIQUE REFERENCES messages(id),
  ai_score FLOAT,
  status VARCHAR(20) DEFAULT 'pending',
  resolution VARCHAR(20),
  admin_id INTEGER REFERENCES users(id),
  resolved_at TIMESTAMP,
  CONSTRAINT review_queue_resolution_check CHECK (
    resolution IS NULL OR resolution IN ('confirmed', 'dismissed')
  )
);

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