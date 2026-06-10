const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test the string immediately
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Connection Failed:', err.message);
  } else {
    console.log('✅ Database Connected Successfully');
  }
});

module.exports = pool;