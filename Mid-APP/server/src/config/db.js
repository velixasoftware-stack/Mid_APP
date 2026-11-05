const { Sequelize } = require('sequelize');
require('dotenv').config();

// Supabase (and most managed Postgres) requires TLS; local dev Postgres does not.
const useSsl = process.env.DB_SSL === 'true';
const dialectOptions = {
  ...(useSsl ? { ssl: { require: true, rejectUnauthorized: false } } : {}),
  keepAlive: true, // stops idle connections being silently dropped by the network in between
};

// Sequelize's default pool closes a connection after 10s idle, so a request
// after a short pause paid for a brand-new TLS connection to the database -
// expensive when the database is far from the server. Keep a couple of
// connections open and reuse them instead.
// max is capped (default 5, override with DB_POOL_MAX): Supabase's session
// pooler allows only 15 clients in total, and during a deploy Render runs the
// old and new instance side by side - at 10 each, the new one couldn't get a
// connection at startup ("max clients reached") and the deploy failed.
const pool = { max: Number(process.env.DB_POOL_MAX) || 5, min: 1, idle: 10 * 60 * 1000, acquire: 30000, evict: 60 * 1000 };

// DATABASE_URL (e.g. Supabase's connection string) takes priority when set;
// otherwise fall back to the discrete DB_* vars used for local development.
const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, { dialect: 'postgres', logging: false, dialectOptions, pool })
  : new Sequelize(
      process.env.DB_NAME || 'hms_lims',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASSWORD || 'postgres',
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false,
        dialectOptions,
        pool,
      }
    );

module.exports = sequelize;
