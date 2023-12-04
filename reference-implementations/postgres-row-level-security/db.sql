-- CREATE TABLES

CREATE TABLE users (
  id TEXT PRIMARY KEY
);

CREATE TABLE items (
  id TEXT PRIMARY KEY
);

CREATE TABLE item_users (
  item_id TEXT NOT NULL REFERENCES items(id),
  user_id TEXT NOT NULL REFERENCES users(id)
);


-- INSERT EXAMPLE DATA

INSERT INTO users VALUES ('1'), ('2');
INSERT INTO items VALUES ('1'), ('2'), ('3'), ('4');
INSERT INTO item_users VALUES ('1', '1'), ('2', '2'), ('3', '1'), ('3', '2');


-- CREATE RLS POLICIES

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_policy ON users FOR SELECT
USING (
  id = current_setting('app.current_user_id')
);

CREATE POLICY select_policy ON item_users FOR SELECT
USING (
  user_id = current_setting('app.current_user_id')
);

CREATE POLICY select_policy ON items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM item_users
    WHERE item_id = id
    AND user_id = current_setting('app.current_user_id')
  )
);


-- CREATE RLS DB USER

-- Create a Postgres user without superuser grants.
-- This user will be subject to the RLS policies,
-- unlike to the default postgres user that is a superuser.
create user querier password 'postgres';

-- Give access to existing tables (does not bypass RLS).
grant all privileges on all tables in schema public to querier;

-- Give access to future tables (does not bypass RLS).
alter default privileges in schema public grant all on tables to querier;
