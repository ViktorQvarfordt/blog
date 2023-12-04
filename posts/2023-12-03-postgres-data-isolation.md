# Postgres data isolation and row level security

### What?

When building SaaS systems, customer data isolation is essential. This can be achieved in different ways, with varying complexity and strictness.

This article outlines different approaches, their pros and cons, and gives reference implementations using Postgres and TypeScript.

Different projects require different degrees of isolation. The Row Level Security approach strikes an interesting balance between security and operational overhead.

### Why?

The goal of data isolation is to minimize the risk of data leakage. This includes both the case of an attacker gaining (partial) access and plain bugs that don't apply permission filtering correctly.

Many projects start out using explicit WHERE clauses in queries for filtering data, but as the application grows, this becomes unmaintainable and has security vulnerabilities.

Enterprise accounts (tenants) require strict data isolation. As engineers, we need to find the right balance between security and operational overhead.

### How?

We will cover these methods of data isolation. Ordered from less strict to more strict (and less operational overhead to more).

1. **Explicit WHERE clauses**
2. **Reusable WITH queries**
3. **Temporary VIEWs**
4. **Row Level Security**
5. **Schema separation**
6. **Logical database separation**
7. **Physical database instance separation**

Approach 1 is very basic and gives no real guarantees. Approaches 2-3 can give ok security guarantees if used correctly in application code. Approach 4 gives strict data isolation guarantees with minimal operational overhead. Approaches 5-7 give deep isolation and by using separate database users can limit the blast radius if an attacker gets in, but comes with larger operational overhead.

## Understanding the differences

These tables capture the essential use case. Keep them in mind as we review the different approaches. Adding additional role-based access control (RBAC) requirements is left as an exercise for the reader.

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

In essence, this approach involves adding `WHERE tenant_id = {tenantId}` to all queries. In the same way, `user_id` and RBAC requirements are added.

**Pros:** The simplest approach to get started with.

**Cons:** Permission checks are duplicated across all queries and joins, which makes it hard to maintain. It is easy to forget to add the necessary WHERE clause to a query, which can lead to data leakage.


### 2. Reusable WITH queries

This approach aims to minimize the risk of forgetting to add the WHERE clause to a query by creating WITH statements that are reused across queries. This assumes one uses a query builder or an ORM that supports reusable queries such as Knex or jOOQ. This translates to queries like this:

```sql
WITH tenant_items AS (
  SELECT * FROM items WHERE tenant_id = {tenantId}
)
SELECT * FROM tenant_items;
```

**Pros:** Declares the permission check once and reuses it across queries.

**Cons:** Requires a query builder. A WITH statement cannot be used across multiple queries (eg. in a transaction).


### 3. Temporary VIEWs in queries

This approach is similar to WITH queries but instead uses temporary views. This translates to queries like this:

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

This approach uses the Postgres feature [Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), which allows to define granular access rights per row. The policies are automatically applied to all queries.

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

The `current_tenant_id` is managed by the db client in application code and queries need to run as a database user without superuser privileges.

See the [Supabase docs](supabase.com/docs/guides/auth/row-level-security) for a more elaborate description of RLS, and see the end of this article for a succinct reference implementation using no frameworks.

**Pros:** Gives strict data isolation guarantees automatically after policies have been set up. Access control can be very granular; different policies can be specified for SELECT, INSERT, UPDATE and DELETE. Any RBAC can be modeled.

**Cons:** Has a performance impact on queries since the RLS policies are evaluated for each row. Application logic is spread out across the database and application code, making it harder to reason about.


### 5. Schemas separation

Postgres has the concept of [schemas](https://www.postgresql.org/docs/current/ddl-schemas.html), which are like namespaces for tables. This approach involves creating one schema for each tenant. There is no need for the `tenant_id` column.

```sql
CREATE SCHEMA tenant_123;

-- Select from a table in the tenant schema.
SELECT * FROM tenant_123.items;

-- Or set search_path to use the schema tenant_123 implicitly for all queries.
SET search_path TO tenant_123;
```

**Pros:** Gives strict data isolation across schemas. Since tables are separated, indexes are smaller, and therefore both inserts and selects are faster compared to having all data in one table.

**Cons:** The data isolation is not granular: not possible to isolate data based on `user_id` or more genral RBAC. Larger operational overhead than the previous approaches. Keeping table definitions in sync across schemas requires explicit management. Eg. when running migrations, the `items` table needs to be migrated separately for each schema.


### 6. Logical database separation

This approach involves creating separate logical databases for each tenant.

```sql
CREATE DATABASE tenant_123;
```

The connection to each logical database uses independent database users and access rights. To connect to another database, a new connection needs to be established.

**Pros:** Deep isolation using separate database users.

**Cons:** Large operational overhead. Not possible to share database extensions, roles or policies.


### 7. Physical database instance separation

This approach involves running a separate database instance for each tenant.

**Pros:** Possible to have different access rights for different engineers and subsystems, eg. separate GCP projects. Possible to have independent downtime across databases, independent resource scaling, and independent regional deployments.

**Cons:** Very large operational overhead and cost.


## RLS reference implementation

The full runnable reference implementation can be found on [GitHub](https://github.com/ViktorQvarfordt/blog/tree/main/reference-implementations/postgres-row-level-security). The essence of the implementation is to set the session variables for RLS before each query. This example uses only `current_user_id` for simplicity, and is implemented with TypeScript and the Node Postgres client [pg](https://github.com/brianc/node-postgres).

```ts
import pg from 'pg'

const pool = new pg.Pool(..)

// Wrap the db client to use RLS
const queryAsUser = async (userId: string, queryStr: string) => {
  const results = await pool.query(`
    SET SESSION app.current_user_id to ${pg.escapeLiteral(userId)};
    ${queryStr}
  `)
  return results[1].rows // The first result is the SET SESSION statement
}

const main = async () => {
  // Use the wrapped db client
  const result1 = await queryAsUser('1', 'SELECT * FROM items')
  const result2 = await queryAsUser('2', 'SELECT * FROM items')

  console.log('Rows for user 1:', result1)
  console.log('Rows for user 2:', result2)

  process.exit()
}

main()
```

Prepare the database:

```sql
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
```

Running the program outputs:

```
Rows for user 1: [ { id: '1' }, { id: '3' } ] 
Rows for user 2: [ { id: '2' }, { id: '3' } ]
```

The results are different since the RLS policy filters the rows based on the current_user_id session variable. See the [full code](https://github.com/ViktorQvarfordt/blog/tree/main/reference-implementations/postgres-row-level-security) for further details and how to run the test.

With these tools at hand, you should be able to select the appropriate data isolation for your application. Happy coding!
