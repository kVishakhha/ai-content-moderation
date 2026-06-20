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

-- Messages table (Person B will build this)
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  content TEXT NOT NULL,
  decision VARCHAR(10) DEFAULT 'pending',
  confidence_score FLOAT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Review Queue table (Person C will build this)
CREATE TABLE IF NOT EXISTS review_queue (
  id SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES messages(id),
  ai_score FLOAT,
  status VARCHAR(20) DEFAULT 'pending',
  admin_id INTEGER REFERENCES users(id),
  resolved_at TIMESTAMP
);