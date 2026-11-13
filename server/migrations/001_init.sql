CREATE TABLE users (
  id uuid PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE todos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  title text NOT NULL CHECK (btrim(title) <> ''),
  note text NOT NULL DEFAULT '',
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE INDEX todos_user_id_idx ON todos (user_id);

CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  todo_id uuid NOT NULL REFERENCES todos (id) ON DELETE CASCADE,
  filename text NOT NULL CHECK (btrim(filename) <> ''),
  mime text NOT NULL CHECK (btrim(mime) <> ''),
  storage_path text NOT NULL CHECK (btrim(storage_path) <> '')
);

CREATE INDEX attachments_todo_id_idx ON attachments (todo_id);
