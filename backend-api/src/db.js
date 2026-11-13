const { Pool, types } = require('pg');

// NUMERIC columns (prices) come back as strings by default; return numbers instead.
types.setTypeParser(1700, (value) => parseFloat(value));

// The team's .env uses SUPABASE_DB_URL. Strip a JDBC prefix if present; node-postgres wants postgresql://...
const connectionString = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '').replace(/^jdbc:/, '');

const pool = new Pool({
  connectionString,
  // Supabase requires SSL. Set DB_SSL=true when connecting to it.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => console.error('Unexpected PG pool error', err));

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
