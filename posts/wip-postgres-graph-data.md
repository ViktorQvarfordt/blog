# WIP: Postgres for modelling graphs and trees

With this post I want to show that Postgres is very capable for modeling and querying/traversing graph data structures. Recursive queries will play a key role.

Many applications involve modeling data as graphs or trees. There are specialized graph databases. But you might not need yet another database, and all the operational complexity it brings.

We will use simple normalized tables to model graphs. We will give implementations for common graph operations, such as getting all (transitive) neighboring nodes, identifying cycles, and finding the shortest path between two nodes.

### Use-case examples

**Example 1:** Modeling transitive properties across hierarchical entities. Properties of a parent entity should implicitly apply to all its (transitive) child entities. Think of modeling permissions for a folder structure in a knowledge base.

**Example 2:** Using a knowledge graph to extract data for a RAG pipeline powering a knowledge assistant.

## Setup

**Start a local Postgres instance:**

```sh
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine
```

**Access the DB:**

```sh
psql postgresql://postgres:postgres@127.0.0.1:5432/postgres
```

**Create tables to model the graph:** We keep the graph simple; this models no particular use-case but demonstrates the fundamental principles.

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

This models a directed graph. The graph is directed since edges have a direction (source -> target).

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

## Queries for traversing the graph

Before showing the general solution with recursive queries, we show the naive approach using joins. You can skip this section but it may be useful for your intuition.

### Naive approach

**Get all direct neighbor nodes to a given node**

```sql
SELECT target_node_id AS node_id
FROM edge
WHERE source_node_id = 1; -- Insert starting node here.
```

```
 node_id
---------
       2
       4
(2 rows)
```

**Get all neighbor nodes to a given node with distance 2**

```sql
SELECT e2.target_node_id AS node_id
FROM edge AS e1
JOIN edge AS e2 on e1.target_node_id = e2.source_node_id
WHERE e1.source_node_id = 1; -- Insert starting node here.
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
WHERE source_node_id = 1 -- Insert starting node here.

UNION

-- 2-step neighbors
SELECT e2.target_node_id AS node_id
FROM edge AS e1
JOIN edge AS e2 on e1.target_node_id = e2.source_node_id
WHERE e1.source_node_id = 1 -- Insert starting node here.

union

-- 3-step neighbors
SELECT e3.target_node_id AS node_id
FROM edge AS e1
JOIN edge AS e2 on e1.target_node_id = e2.source_node_id
JOIN edge AS e3 on e2.target_node_id = e3.source_node_id
WHERE e1.source_node_id = 1; -- Insert starting node here.
```

Now let's do this it for the general case:

### Get all nodes reachable from a given node

```sql
WITH RECURSIVE traversed AS (
  SELECT
    target_node_id AS node_id,
    1 AS depth,
    ARRAY[source_node_id] AS path
  FROM edge
  WHERE source_node_id = 1 -- Insert starting node here.

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

We can prevent this by stopping when we reach a cycle. We add `WHERE NOT traversed.node_id = ANY(traversed.path)`:

```sql
WITH RECURSIVE traversed AS (
  SELECT
    target_node_id AS node_id,
    1 AS depth,
    ARRAY[source_node_id] AS path
  FROM edge
  WHERE source_node_id = 1 -- Insert starting node here.

  UNION ALL

  SELECT
    edge.target_node_id,
    traversed.depth + 1,
    traversed.path || edge.source_node_id
  FROM traversed
  JOIN edge ON edge.source_node_id = traversed.node_id
  WHERE
  	NOT traversed.node_id = ANY(traversed.path) -- Stop on cycle
  	AND traversed.depth < 100 -- Sanity check
)
SELECT node_id, depth, path || node_id AS path
FROM traversed;
```

```
 node_id | depth |   path
---------+-------+-----------
       2 |     1 | {1,2}
       4 |     1 | {1,4}
       3 |     2 | {1,2,3}
       1 |     3 | {1,2,3,1}
(4 rows)
```

## Enforcing no cycles in the data

It may suffice to ignore cycles when selecting, like above. But we may want to prevent cycles from ever being created, so that the data really is an acyclic graph (a tree).

This can be done with a `CHECK` constraint to the edge table. To do this, we will create a function that checks for cycles.

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

To stop computing when the first cycle has been detected, we can use the `FOR rec IN query LOOP` construct. See the [Postgres docs](https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-RECORDS-ITERATING) for more details.

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

We can now add this CHECK after we delete the row that violates it:

```sql
DELETE FROM edge where source_node_id = 3 AND target_node_id = 1;

ALTER TABLE edge ADD CONSTRAINT check_no_cycles CHECK (NOT has_cycle(source_node_id, target_node_id));
```

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

Let's test the two functions:

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

SELECT all_paths(1, 5);
--   all_paths
-- -------------
--  {1,2,5}
--  {1,3,4,5}
--  {1,2,3,4,5}
-- (3 rows)

SELECT shortest_path(1, 5);
--  shortest_path
-- ---------------
--  {1,2,5}
-- (1 row)
```

## Conclusion

As we've seen, plain Postgres is all we need for many graph queries.

In doing so, you get the benefits of maintaining only one database and avoiding syncing data and permissions across different databases. You will likely need Postgres even if you opt for a graph database (such as Neo4j), to maintain basic application data.

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

You don't have to use a dedicated graph database to access optimized graph queries. There are extensions for postgres such as [AGE](https://github.com/apache/age) and [pgRouting](https://github.com/pgRouting/pgrouting). However, these are not that common and might not be available in your managed sql database provider.
