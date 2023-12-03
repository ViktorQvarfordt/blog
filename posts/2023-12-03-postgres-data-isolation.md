# How to isolate data for SaaS enterprise with Postgres

### What?

When building SaaS systems, customer data isolation is essential. This can be achieved in different ways, with varying complexity and strictness.

This article outlines different approaches, their pros and cons, and gives reference implementations using Postgres and TypeScript.

The Row Level Security approach strikes good balance between security and operational overhead.

### Why?

The goal of data isolation is to minimize the risk of data leakage. This includes both the case of an attacker getting (partial) access and plain bugs that don't apply permission filtering correctly.

Many projects use explicit WHERE checks in queries for filtering data, but this quickly gets unmaintainable and has security vulnerabilities.

Enterprise customers, called tenants, expect their data to be more strictly isolated from other tenants.

### How?

We will cover these methods of data isolation per tenant. Ordered from less strict to more strict (and less operational overhead to more).

1. **Explicit WHERE clauses**
2. **Temporary VIEWs**
3. **WITH queries**
4. **Row Level Security**
5. **Separate database schemas**
6. **Separate logical databases**
7. **Separate physical database instances**

## Understanding the differences

The essential use case is captured by these tables:

```sql
CREATE TABLE users (
  tenant_id TEXT NOT NULL,
  id TEXT PRIMARY KEY
);

CREATE TABLE items (
  tenant_id TEXT NOT NULL,
  id TEXT PRIMARY KEY
);

CREATE TABLE item_users (
  tenant_id TEXT NOT NULL
  item_id TEXT NOT NULL REFERENCES items(id),
  user_id TEXT NOT NULL REFERENCES users(id)
);
```

### 1. Explicit WHERE clauses

This approach involves adding a `tenant_id` column to all tables and adding a `WHERE` clause to all queries.

**Pros:** The simplest approach to get started with.

**Cons:** Permission checks are duplicated across all queries and joins, which gets hard to maintain. It is easy to forget to add the necessary `WHERE` clause to a query, which can lead to data leakage.


### 2. Reusable WITH queries

This approach aims to minimize the risk of forgetting to add the `WHERE` clause to a query by creating WITH statements that are reused across queries. This assumes one is using a query builder or ORM that supports reusable queries such as Knex and jOOQ. This translates to queries like this:

```sql
WITH tenant_items AS (
  SELECT * FROM items WHERE tenant_id = {tenantId}
)
SELECT * FROM tenant_items;
```

**Pros:** Declares the permission check once and reuses it across queries.

**Cons:** Requires a query builder. A WITH statement cannot be used across multiple queries (eg. in a transaction).


### 3. Temporary views in queries

This approach is similar to WITH queries, but uses temporary views instead. This translates to queries like this:

```sql
CREATE TEMPORARY VIEW tenant_items AS (
  SELECT * FROM items WHERE tenant_id = {tenantId}
);

SELECT * FROM tenant_items;
```

The idea is that the VIEW is created once and reused across queries.

**Pros:** Declares the permission check once and reuses it across queries. Can be used across multiple queries in a transaction.

**Cons:** The views need to be used correctly, there are no guarantees that the view is used in a query.


### 4. Row level security (RLS)

Postgres has the concept of [row level security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) which allows to define granular access rights per rows that are applied to all queries.

```sql
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_policy ON items FOR SELECT
USING (
  tenant_id = current_setting('app.current_tenant_id')
);
```

Think of RLS policies as implicilty attaching a `WHERE` clause to all queries. In this case, these two queries are equivalent:

```sql
SELECT * FROM users;
SELECT * FROM users WHERE tenant_id = current_setting('app.current_tenant_id');
```

The `current_tenant_id` is managed by the db client in application code. See the reference implementation at the end of this article for more details.

**Pros:** Gives stric data isolation guarantees automatically after policies have been set up. Access control can be very granular.

**Cons:** Has a performance impact on queries since the RLS policies are evaluated for each row. Application logic is spread out across the database and application code, which makes it harder to reason about.


### 5. Separate database schemas

Postgres has the concept of [schemas](https://www.postgresql.org/docs/current/ddl-schemas.html), which are like namespaces for tables. This approach involves creating one schema for each tenant. There is no need for the `tenant_id` column.

```sql
CREATE SCHEMA tenant_123;

-- Select from a table in the tenant schema.
SELECT * FROM tenant_123.items;

-- Or set search_path to use the schema tenant_123 implicitly for all queries.
SET search_path TO tenant_123;
```

**Pros:** Gives a strict data isolation across schemas. Since tables are separated, indexes are smaller and therefore both inserts and selects are faster compared to having all data in one table.

**Cons:** The data isolation is not granular, not possible to isolate data based on user_id. Larger operational overhead than the previous approaches. Keeping tables in sync across schemas requires explicit management (eg. when running migrations).


### 6. Separate logical databases

This approach involves creating separate logical databases for each tenant. There is no need for the `tenant_id` column.

```sql
CREATE DATABASE tenant_123;
```

The connection to a logical database is explicit. To connect to another database, a new connection needs to be established.

**Pros:** Deep isolation.

**Cons:** Large operational overhead. Not possible to share database extensions, roles or policies.


### 7. Separate physical database instances

This approach involves running a separate database instance for each tenant. There is no need for the `tenant_id` column.

**Pros:** Possible to have different access rights for different engineers and subsystems, eg. separate GCP projects. Possible to have independent downtime across databases, independent resource scaling, and independent regional deployments.

**Cons:** Very large operational overhead and cost.


## RLS demo

Start a local Postgres instance via docker:

``` sh
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine
```



Insert example data:

INSERT INTO users VALUES ('1'), ('2');
INSERT INTO items VALUES ('1'), ('2'), ('3'), ('4');
INSERT INTO item_users VALUES ('1', '1'), ('2', '2'), ('3', '1'), ('3', '2');


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
