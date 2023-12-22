# WIP: Postgres for modelling graphs and trees

With this post I want to show that Postgres is very capable for modeling and querying/traversing graph data structures. Recursive queries will play a key role.

Many applications involve modeling data as graphs or trees. Engineers sometimes reach for graph databases. But you might not need yet another database, and all the operational complexity it brings.

We will use simple normalized tables to model graphs. We will give implementations for common graph operations, such as getting all (transitive) neighboring nodes or finding the shortest path between two nodes.

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

You can imagine many additional properties to the graph. The graph can be turned into a weighted graph by adding a `weight REAL NOT NULL` column to the `edge` table. This may represent the cost utilizing an edge.

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

**Get all neighbor nodes to a given node**

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

**Get all 2-step neighbor nodes to a given node**

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

You can keep adding joins, but let's do it for the general case:

### Get all nodes reachable from a given node

```sql
WITH RECURSIVE traversed AS (
  SELECT
  	ARRAY[source_node_id] AS path,
  	target_node_id AS node_id
  FROM edge
  WHERE source_node_id = 1 -- Insert starting node here.

  UNION ALL

  SELECT
    traversed.path || edge.source_node_id,
  	edge.target_node_id
  FROM traversed
  JOIN edge ON edge.source_node_id = traversed.node_id
)
SELECT node_id, path || node_id AS path
FROM traversed
ORDER BY path;
```

```
 node_id |  path
---------+---------
       2 | {1,2}
       3 | {1,2,3}
       4 | {1,4}
(3 rows)
```

Recursive queries are very powerful. To understand them, let's look at how they are evaluated.

### Understanding recursive queries

Recursive queries are evaluated iteratively:

1. Initialize two empty variables `totalRows` and `previousRows`, both of type `Set<Row>`. 
2. The select statement _above_ `UNION ALL` is evaluated and the resulting rows are assigned to both variables.
3. The select statement _below_ `UNION ALL` is evaluated, with the table self-reference referring to `previousRows`, the resulting rows are appended to `totalRows` and overwrites `previousRows`.
4. Repeat step 3 until `previousRows` is empty.
5. Return `totalRows`.

### Preventing cycles

Let's insert one more edge to create a cycle (1 -> 2 -> 3 -> 1)

```sql
INSERT INTO edge (source_node_id, target_node_id) VALUES (3, 1);
```

With this change, the previous recursive query will get stuck in an infinite loop. We can see the initial result by adding `LIMIT 10` (and removing `ORDER BY`):

```
 node_id |       path
---------+-------------------
       2 | {1,2}
       4 | {1,4}
       3 | {1,2,3}
       1 | {1,2,3,1}
       2 | {1,2,3,1,2}
       4 | {1,2,3,1,4}
       3 | {1,2,3,1,2,3}
       1 | {1,2,3,1,2,3,1}
       2 | {1,2,3,1,2,3,1,2}
       4 | {1,2,3,1,2,3,1,4}
(10 rows)
```

We can prevent this by stopping when we reach a cycle.

```sql
WITH RECURSIVE traversed AS (
  SELECT
    1 as depth,
  	ARRAY[source_node_id] AS path,
  	target_node_id AS node_id
  FROM edge
  WHERE source_node_id = 1 -- Insert starting node here.

  UNION ALL

  SELECT
    traversed.depth + 1,
    traversed.path || edge.source_node_id,
  	edge.target_node_id
  FROM traversed
  JOIN edge ON edge.source_node_id = traversed.node_id
  WHERE
  	NOT traversed.node_id = ANY(traversed.path) -- Stop on cycle
  	AND traversed.depth < 100 -- Sanity check
)
SELECT node_id, path || node_id AS path, depth
FROM traversed
ORDER BY path;
```

```
 node_id |   path    | depth
---------+-----------+-------
       2 | {1,2}     |     1
       3 | {1,2,3}   |     2
       1 | {1,2,3,1} |     3
       4 | {1,4}     |     1
(4 rows)
```

## Restricting the graph to a tree

A tree is a graph without cycles. So, how do we prevent cycles? In the above, we stopped traversing the graph when we encountered a cycle. Otherwise, the recursive select would never terminate.

In many applications, what we really need is a tree. It may suffice to ignore cycles when selecting, like above. But we may want to prevent cycles from ever being created. This can be done with a `CHECK`:

Not optimized:

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

Optimized:

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


## When is Postgres not sufficient?

* Identifying optimal paths. Although, this can be done with a recursive query as above and assigning scores to each traversed path according to the search criteria, then selecting the path with the highest score.

* Find all 


AGE extension
