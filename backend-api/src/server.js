require('dotenv').config(); // must run before ./db reads DATABASE_URL

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
  console.error('SUPABASE_DB_URL (or DATABASE_URL) is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = require('./app');
const { startJobs } = require('./jobs');

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  startJobs();
});
