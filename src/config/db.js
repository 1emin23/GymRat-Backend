const { Pool } = require("pg");
require("dotenv").config();

// Öncelik: DATABASE_URL varsa Neon (bulut) bağlantısını kullan.
// Yoksa local PostgreSQL bağlantı bilgilerini kullan.
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };

const pool = new Pool(poolConfig);

// Bağlantıyı test et
pool.connect((err, client, release) => {
  if (err) {
    return console.error("❌ Veritabanı bağlantı hatası:", err.stack);
  }
  const dbType = process.env.DATABASE_URL ? "Neon PostgreSQL" : "Local PostgreSQL";
  console.log(
    `🚀 ${dbType} Bağlantısı Başarılı: ${new Date().toLocaleDateString()}`,
  );
  release();
});

module.exports = pool;
