# Modeling graphs and trees in Postgres

In this article, we explore how Postgres, a powerful and versatile relational database, can be effectively used to model and traverse graph and tree data structures. While specialized graph databases exist, Postgres offers a robust alternative without the need for additional database systems.

We show how to implementat common graph operations:

* Getting all (transitive) neighboring nodes.
* Detecting (and preventing) cycles.
* Finding the shortest path (and all paths) between two nodes.

We will use simple normalized tables to model the graph. Recursive queries will play a key role for traversing the graph. Finally, we'll use advanced Postgres control structures for performance optimizations.

### Use-case examples

**Example 1:** Modeling permissions for a folder structure in a knowledge base.

**Example 2:** Traversing a knowledge graph powering a knowledge assistant.

More generally, you can think of any use-case that requires modeling transitive properties across hierarchical entities where properties of a parent entity should propagate to all its (transitive) child entities. 

## Setup

**Start a local Postgres instance:**

```sh
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine
```

**Access the DB:**

```sh
psql postgresql://postgres:postgres@127.0.0.1:5432/postgres
```

**Create tables to model the graph:**

```sql
CREATE TABLE node (
  id BIGINT PRIMARY KEY
);

CREATE TABLE edge (
  source_node_id BIGINT REFERENCES node(id),
  target_node_id BIGINT REFERENCES node(id),

  PRIMARY KEY (source_node_id, target_node_id),
  CHECK (source_node_id != target_node_id)
);
```

We keep the graph simple. This models no particular use-case but demonstrates the fundamental principles. This is a directed graph since edges have a direction (source -> target).

You can imagine many additional properties of the graph. For example, the graph can be turned into a weighted graph by adding a `weight REAL NOT NULL` column to the `edge` table. This may represent the cost utilizing an edge.

**Insert example data:**

```sql
INSERT INTO node (id) VALUES
(1),
(2),
(3),
(4);

INSERT INTO edge (source_node_id, target_node_id) VALUES
(1, 2),
(2, 3),
(1, 4);
```
<img src="../assets/simple-graph.png" style="width: 266px;" />

## Queries for traversing the graph

Before showing the general solution with recursive queries, we the naive approach using joins. You can skip this section but it may be useful for your intuition.

### Naive approach

**Get all direct neighbor nodes to a given node:**

```sql
SELECT target_node_id AS node_id
FROM edge
WHERE source_node_id = 1; -- Insert starting node here
```

```
 node_id
---------
       2
       4
(2 rows)
```

**Get all neighbor nodes to a given node with distance 2:**

```sql
SELECT e2.target_node_id AS node_id
FROM edge AS e1
JOIN edge AS e2 on e1.target_node_id = e2.source_node_id
WHERE e1.source_node_id = 1; -- Insert starting node here
```

```
 node_id
---------
       3
(1 row)
```

We can continue adding joins to go further. We can also combine the results to get all the nodes at distance 1, 2 and 3:

```sql
-- 1-step neighbors
SELECT target_node_id AS node_id
FROM edge
WHERE source_node_id = 1 -- Insert starting node here

UNION

-- 2-step neighbors
SELECT e2.target_node_id AS node_id
FROM edge AS e1
JOIN edge AS e2 on e1.target_node_id = e2.source_node_id
WHERE e1.source_node_id = 1 -- Insert starting node here

union

-- 3-step neighbors
SELECT e3.target_node_id AS node_id
FROM edge AS e1
JOIN edge AS e2 on e1.target_node_id = e2.source_node_id
JOIN edge AS e3 on e2.target_node_id = e3.source_node_id
WHERE e1.source_node_id = 1; -- Insert starting node here
```

```
 node_id
---------
       4
       2
       3
(3 rows)
```

Now let's do it it for the general case:

### Get all nodes reachable from a given node

```sql
WITH RECURSIVE traversed AS (
  SELECT
    target_node_id AS node_id,
    1 AS depth,
    ARRAY[source_node_id] AS path
  FROM edge
  WHERE source_node_id = 1 -- Insert starting node here

  UNION ALL

  SELECT
    edge.target_node_id,
    traversed.depth + 1,
    traversed.path || edge.source_node_id
  FROM traversed
  JOIN edge ON edge.source_node_id = traversed.node_id
)
SELECT node_id, depth, path || node_id AS path
FROM traversed;
```

```
 node_id | depth |  path
---------+-------+---------
       2 |     1 | {1,2}
       4 |     1 | {1,4}
       3 |     2 | {1,2,3}
```

If you want nodes at a specific depth, just add `WHERE depth = {selectedDepth}`

Recursive queries are very powerful. To understand them, let's look at how they are evaluated.

### Understanding recursive queries

The term before `UNION [ALL]` is the _non-recursive term_, and the term after is the _recursive term_. Recursive queries are evaluated iteratively:

1. Evaluate the non-recursive term. For UNION (but not UNION ALL), discard duplicate rows. Include all remaining rows in the result of the recursive query, and also place them in a temporary working table.
2. So long as the working table is not empty, repeat these steps:
   1. Evaluate the recursive term, substituting the current contents of the working table for the recursive self-reference. For UNION (but not UNION ALL), discard duplicate rows and rows that duplicate any previous result row. Include all remaining rows in the result of the recursive query, and also place them in a temporary intermediate table.
   2. Replace the contents of the working table with the contents of the intermediate table, then empty the intermediate table.

See the [Postgres docs](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-RECURSIVE) for more details.

<!-- 
1. Initialize two empty variables `totalRows` and `previousRows`, both of type `Set<Row>`. 
2. The recursive term is evaluated and the resulting rows are assigned to both variables.
3. The select statement _below_ `UNION ALL` is evaluated, with the table self-reference referring to `previousRows`, the resulting rows are appended to `totalRows` and overwrites `previousRows`.
4. Repeat step 3 until `previousRows` is empty.
5. Return `totalRows`.
-->


## Preventing cycles

Let's insert one more edge to create a cycle (1 -> 2 -> 3 -> 1)

```sql
INSERT INTO edge (source_node_id, target_node_id) VALUES (3, 1);
```

<img src="../assets/simple-graph-with-cycle.png" style="width: 262px;" />

With this change, the previous recursive query will get stuck in an infinite loop. We can see the initial result by adding `LIMIT 10`:

```
 node_id | depth |       path
---------+-------+-------------------
       2 |     1 | {1,2}
       4 |     1 | {1,4}
       3 |     2 | {1,2,3}
       1 |     3 | {1,2,3,1}
       2 |     4 | {1,2,3,1,2}
       4 |     4 | {1,2,3,1,4}
       3 |     5 | {1,2,3,1,2,3}
       1 |     6 | {1,2,3,1,2,3,1}
       2 |     7 | {1,2,3,1,2,3,1,2}
       4 |     7 | {1,2,3,1,2,3,1,4}
(10 rows)
```

We can prevent this by stopping before we reach a cycle by adding `WHERE NOT edge.target_node_id = ANY(traversed.path)`:

```sql
WITH RECURSIVE traversed AS (
  SELECT
    target_node_id AS node_id,
    1 AS depth,
    ARRAY[source_node_id] AS path
  FROM edge
  WHERE source_node_id = 1 -- Insert starting node here

  UNION ALL

  SELECT
    edge.target_node_id,
    traversed.depth + 1,
    traversed.path || edge.source_node_id
  FROM traversed
  JOIN edge ON edge.source_node_id = traversed.node_id
  WHERE
  	NOT edge.target_node_id = ANY(traversed.path) -- Stop on cycle
  	AND traversed.depth < 100 -- Sanity check
)
SELECT node_id, depth, path || node_id AS path
FROM traversed;
```

```
 node_id | depth |  path
---------+-------+---------
       2 |     1 | {1,2}
       4 |     1 | {1,4}
       3 |     2 | {1,2,3}
(3 rows)
```

With a slight variation we can see the cycles explicitly:

```sql
WITH RECURSIVE traversed AS (
  SELECT
    target_node_id AS node_id,
    1 AS depth,
    ARRAY[source_node_id] AS path,
    FALSE AS is_cycle
  FROM edge
  WHERE source_node_id = 1 -- Insert starting node here

  UNION ALL

  SELECT
    edge.target_node_id,
    traversed.depth + 1,
    traversed.path || edge.source_node_id,
    edge.target_node_id = ANY(traversed.path)
  FROM traversed
  JOIN edge ON edge.source_node_id = traversed.node_id
  WHERE
  	NOT traversed.is_cycle -- Stop on cycle
  	AND traversed.depth < 100 -- Sanity check
)
SELECT node_id, depth, path || node_id AS path, is_cycle
FROM traversed;
```

```
 node_id | depth |   path    | is_cycle
---------+-------+-----------+----------
       2 |     1 | {1,2}     | f
       4 |     1 | {1,4}     | f
       3 |     2 | {1,2,3}   | f
       1 |     3 | {1,2,3,1} | t
(4 rows)
```

## Enforcing no cycles in the data

It may suffice to ignore cycles when selecting, like above. But we may want to prevent cycles from ever being created, so that the data is really an acyclic graph (a tree).

This can be done with a `CHECK` constraint on the edge table. To do this, we will create a function that checks for cycles. The function `has_cycle` works by checking "if an edge with the given source_node_id and target_node_id was to be inserted, would there be a cycle?".

First, a non-optimized implementation that keeps computing after the first cycle has been detected:

```sql
CREATE OR REPLACE FUNCTION has_cycle(input_source_node_id BIGINT, input_target_node_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  result BOOLEAN;
BEGIN
  WITH RECURSIVE traversed AS (
    SELECT
  	  ARRAY[input_source_node_id] AS path,
  	  input_target_node_id AS target_node_id,
  	  false as is_cycle

    UNION ALL

    SELECT
      traversed.path || edge.source_node_id,
      edge.target_node_id,
      edge.target_node_id = ANY(traversed.path)
    FROM traversed
    JOIN edge ON edge.source_node_id = traversed.target_node_id
    WHERE NOT traversed.is_cycle
  )
  SELECT EXISTS (SELECT 1 FROM traversed WHERE target_node_id = ANY(path)) INTO result;

  RETURN result;
END;
$$;
```

As an optimization, we can stop computing when the first cycle has been detected. We can use the `FOR rec IN query LOOP statement END LOOP` construct. This construct allows us to tap into the row selection process. Each time a row is generated in `query`, it is assigned to `rec` and `statement` is executed. From `statement` we can make an early exit and stop generating rows in `query`. (See the [Postgres docs](https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-RECORDS-ITERATING) for more details.)

```sql
CREATE OR REPLACE FUNCTION has_cycle(input_source_node_id BIGINT, input_target_node_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    WITH RECURSIVE traversed AS (
  	  SELECT
        ARRAY[input_source_node_id] AS path,
        input_target_node_id AS target_node_id

      UNION ALL

      SELECT
        traversed.path || edge.source_node_id,
        edge.target_node_id
      FROM traversed
      JOIN edge ON edge.source_node_id = traversed.target_node_id
    )
    SELECT * FROM traversed
  LOOP
    IF rec.target_node_id = ANY(rec.path) THEN
      RETURN TRUE; -- Early return, stop looking when first cycle is detected
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;
```

We can now add add a check CHECK to enforce that no cycles ever get inserted. First, we delete the row that violates the check:

```sql
DELETE FROM edge where source_node_id = 3 AND target_node_id = 1;

ALTER TABLE edge ADD CONSTRAINT check_no_cycles CHECK (NOT has_cycle(source_node_id, target_node_id));
```

The CHECK runs before a row is inserted, both `source_node_id` and `target_node_id` refer to columns of the row that is to be inserted.

If we now try to insert an edge that results in a cycle, we will get an error:

```sql
INSERT INTO edge (source_node_id, target_node_id) VALUES (3, 1);
-- ERROR:  new row for relation "edge" violates check constraint "check_no_cycles"
```

## Finding the shortest path

Using the principles of the `has_cycle` function, we can write a function that finds the shortest path between two nodes, using the same early-stopping optimization as for `has_cycle`:

```sql
CREATE OR REPLACE FUNCTION shortest_path(input_source_node_id BIGINT, input_target_node_id BIGINT)
RETURNS BIGINT[]
LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    WITH RECURSIVE traversed AS (
  	  SELECT
	  	ARRAY[edge.source_node_id] AS path,
	    edge.target_node_id AS node_id
	  FROM edge
	  WHERE edge.source_node_id = input_source_node_id

      UNION ALL

      SELECT
        traversed.path || edge.source_node_id,
        edge.target_node_id
      FROM traversed
      JOIN edge ON edge.source_node_id = traversed.node_id
    )
    SELECT path || node_id as path FROM traversed
  LOOP
    IF input_target_node_id = ANY(rec.path) THEN
      RETURN rec.path; -- Early return, stop looking when first path is detected
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;
```

Get all paths between two nodes:

```sql
CREATE OR REPLACE FUNCTION all_paths(input_source_node_id BIGINT, input_target_node_id BIGINT)
RETURNS SETOF BIGINT[]
LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
BEGIN
  RETURN QUERY WITH RECURSIVE traversed AS (
    SELECT
      ARRAY[edge.source_node_id] AS path,
      edge.target_node_id AS node_id
    FROM edge
    WHERE edge.source_node_id = input_source_node_id

    UNION ALL

    SELECT
      traversed.path || edge.source_node_id,
      edge.target_node_id
    FROM traversed
    JOIN edge ON edge.source_node_id = traversed.node_id
    WHERE NOT edge.target_node_id = ANY(traversed.path)
  )
  SELECT path || node_id AS path
  FROM traversed
  WHERE node_id = input_target_node_id;
END;
$$;
```

Let's test the two functions. First, we prepare some test data:

```sql
DELETE FROM edge;

DELETE FROM node;

INSERT INTO node (id) VALUES (1), (2), (3), (4), (5);

INSERT INTO edge (source_node_id, target_node_id) VALUES
(1, 2),
(2, 3),
(3, 4),
(4, 5),
(1, 3),
(2, 5);
```

Now test the functions:

```sql
SELECT all_paths(1, 5);
```

```
  all_paths
-------------
 {1,2,5}
 {1,3,4,5}
 {1,2,3,4,5}
(3 rows)
```

```sql
SELECT shortest_path(1, 5);
```

```
 shortest_path
---------------
 {1,2,5}
(1 row)
```

## Conclusion

As we've seen, plain Postgres works well for many graph queries.

By not introducing another database to one's stack one gets the benefits of maintaining only one database and avoiding syncing data and permissions across different databases. One will likely need Postgres even if one opts for a graph database (such as Neo4j), to maintain basic application data.

We wrap up by giving you a hint of what else there is.

### Beyond Postgres: The Cypher query language (GQL)

The [Cypher Query Language](https://en.wikipedia.org/wiki/Cypher_(query_language)) (GQL: Graph Query Language) can express the `has_cycle` and `shortest_path` queries much more succinctly:

```sql
-- Find cycle
MATCH path = (n)-[*]->(n)
WHERE length(path) > 1
RETURN path LIMIT 1

-- Find path
MATCH (start:Node {id: 'StartNodeID'}), (end:Node {id: 'EndNodeID'})
MATCH p = shortestPath((start)-[*]-(end))
RETURN p
```

There are extensions for postgres such as [AGE](https://github.com/apache/age) (supports Cypher) and [pgRouting](https://github.com/pgRouting/pgrouting) that add powerful graph operations to Postgres. However, these are not that common and might not be available in your managed sql database provider.

Plain Postgres might be all you need.

We used these methods:

* [Recursive queries](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-RECURSIVE).
* [Postgres functions](https://www.postgresql.org/docs/current/sql-createfunction.html) with the [plpgsql](https://www.postgresql.org/docs/current/plpgsql.html) language.
* The `FOR rec IN query LOOP statement END LOOP` [control structure](https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-RECORDS-ITERATING).
