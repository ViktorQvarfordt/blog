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

// Wrap the db client to use schemas
const queryAsTenant = async (tenantId: string, queryStr: string) => {
  const results = await pool.query(`
    SET search_path TO ${pg.escapeIdentifier(`tenant_${tenantId}`)}, 'public'
    ${queryStr}
  `)
  return results[1].rows
}

// Wrap the db client to use both RLS and schemas
const queryAsTenantAndUser = async (tenantId: string, userId, queryStr: string) => {
  const results = await pool.query(`
    SET search_path TO ${pg.escapeIdentifier(`tenant_${tenantId}`)}, 'public'
    SET SESSION app.current_user_id to ${pg.escapeLiteral(userId)};
    ${queryStr}
  `)
  return results[2].rows
}

// Wrap the db client to use RLS using multiple statements
const queryAsUser2 = async (userId: string, queryStr: string) => {
  const client = await pool.connect()

  try {
    await client.query(`SET SESSION app.current_user_id to ${pg.escapeLiteral(userId)}`)
    const results = await client.query(queryStr)
    return results.rows
  } finally {
    client.release()
  }
}
