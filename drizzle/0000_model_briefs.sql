CREATE TABLE model_connections (
  owner TEXT NOT NULL,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, provider)
);
--> statement-breakpoint
CREATE TABLE brief_settings (
  owner TEXT PRIMARY KEY NOT NULL,
  extract_provider TEXT NOT NULL,
  extract_model TEXT NOT NULL,
  write_provider TEXT NOT NULL,
  write_model TEXT NOT NULL,
  daily_limit INTEGER NOT NULL CHECK (daily_limit BETWEEN 1 AND 30)
);
--> statement-breakpoint
CREATE TABLE brief_jobs (
  owner TEXT NOT NULL,
  story_id TEXT NOT NULL,
  cache_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'ready', 'failed')),
  lease TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result TEXT,
  PRIMARY KEY (owner, cache_id)
);
--> statement-breakpoint
CREATE INDEX brief_jobs_story ON brief_jobs (owner, story_id, finished_at);
--> statement-breakpoint
CREATE TABLE brief_attempts (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (owner, id)
);
--> statement-breakpoint
CREATE INDEX brief_attempts_day ON brief_attempts (owner, started_at);
