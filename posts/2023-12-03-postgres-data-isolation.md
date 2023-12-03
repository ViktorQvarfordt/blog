# How to isolate data for SaaS enterprise with Postgres

### What?

When building SaaS systems, customer data isolation is essential. This can be achieved in different ways, with varying complexity and strictness.

This article outlines different approaches, their pros and cons, and gives proof of concept implementations using Postgres and TypeScript.

### Why?

The goal of data isolation is to minimize the risk of data leakage. This includes both the case of an attacker getting (partial) access and plain bugs that don't apply permission filtering correctly.

Most projects start with explicit WHERE checks in queries for data isolation, but this quickly gets unmaintainable and has security vulnerabilities.

### How?

Levels of data isolation per tenant. From more strict to less strict (and more operational overhead to less).

1. **Separate physical database instances**
2. **Separate logical databases**
3. **Separate database schemas**
4. **Row Level Security**
5. **Temporary views**
6. **Explicit WHERE clauses**

Let's compare them.
****
## Understanding the differences

### 1. Separate physical database instances

Pros: Give the databases independent access for different engineers and subsystems, eg. separate GCP projects. Allows for independent downtime across databases, independent resource scaling, and independent regional deployments.

Cons: Large operational overhead and cost.

### 2. Separate logical databases

```sql
CREATE DATABASE mydatabase;
```

Pros: Less overhead than separate physical database instances.

Cons: Not possible to share database extensions, roles or policies.

### 3. Separate database schemas

```sql
CREATE SCHEMA my_schema;
SET search_path TO my_schema;
-- Selects will now use my_schema implicitly.

-- Or use a schema explicitly.
SELECT * FROM my_schema.my_table;
```

Pros: Less overhead than separate logical databases. Database extensions, roles and policies can be shared. Since tables are separated, indexes are smaller and therefore both inserts and selects are faster compared to having all data in one table.

Cons: Keeping tables in sync across schemas requires explicit management (eg. when running migrations).

### 4. Row level security (RLS)

Pros: asdf

Cons: Has a pote

### 5. Temporary views

Pros:

Cons:

### 6. Explicit WHERE clauses

Pros: The simplest approach to get started with.

Cons: Permission checks are duplicated across all queries and joins, which gets hard to maintain and

## RLS demo
Start a local Postgres instance via docker:
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine
Create tables:
CREATE TABLE users (
  id TEXT PRIMARY KEY
);

CREATE TABLE items (
  id TEXT PRIMARY KEY
);

CREATE TABLE item_users (
  item_id TEXT NOT NULL REFERENCES items(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  UNIQUE (user_id, item_id)
);
Insert example data:

INSERT INTO users VALUES ('1'), ('2');
INSERT INTO items VALUES ('1'), ('2'), ('3'), ('4');
INSERT INTO item_users VALUES ('1', '1'), ('2', '2'), ('3', '1'), ('3', '2');
Enable RLS and set up RLS policies:
alter table users enable row level security;
alter table items enable row level security;
alter table item_users enable row level security;

create policy select_policy on users for select
using (
  id = current_setting('app.current_user_id')
);

create policy select_policy on item_users for select
using (
  user_id = current_setting('app.current_user_id')
);

create policy select_policy on items for select
using (
  exists (
    select 1 from item_users
    where item_id = id
    and user_id = current_setting('app.current_user_id')
  )
);
Create a Postgres user without superuser grants. This user will be subject to the RLS policies, unlike to the default postgres user that is a superuser.
create user querier password 'postgres';

-- Give access to existing tables (does not bypass RLS)
grant all privileges on all tables in schema public to querier;

-- Give access to future tables (does not bypass RLS)
alter default privileges in schema public grant all on tables to querier;
