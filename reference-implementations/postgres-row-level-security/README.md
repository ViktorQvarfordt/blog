# Running the reference implementation

Check the `db.sql` and `main.ts` files for the implementation.

Sart the database:

``` sh
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine
```

Initialise the database:

```sh
psql postgresql://postgres:postgres@127.0.0.1:5432/postgres -f db.sql
```

Run:

```sh
pnpm tsx main.ts
```
