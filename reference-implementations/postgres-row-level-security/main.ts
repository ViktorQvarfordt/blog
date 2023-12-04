import pg from 'pg'

const pool = new pg.Pool({
  connectionString: 'postgresql://querier:postgres@127.0.0.1:5432/postgres',
})

// Wrap the db client to use RLS
const queryAsUser = async (userId: string, queryStr: string) => {
  const results = await pool.query(`
    SET SESSION app.current_user_id to ${pg.escapeLiteral(userId)};
    ${queryStr}
  `)
  return results[1].rows // The first result is the SET SESSION statement
}

const main = async () => {
  const result1 = await queryAsUser('1', 'SELECT * FROM items')
  const result2 = await queryAsUser('2', 'SELECT * FROM items')

  console.log('Rows for user 1:', result1)
  console.log('Rows for user 2:', result2)

  process.exit()
}

main()

/**
 * Output:
 * 
 * Rows for user 1: [ { id: '1' }, { id: '3' } ] 
 * Rows for user 2: [ { id: '2' }, { id: '3' } ]
 */
