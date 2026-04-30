const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  // Neon'dan aldığın "connection string" tek başına yeterlidir
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // Bulut veritabanları (Neon, Railway vb.) güvenli bağlantı (SSL) gerektirir
    rejectUnauthorized: false,
  },
});

// Bağlantıyı test et
pool.connect((err, client, release) => {
  if (err) {
    return console.error("❌ Veritabanı bağlantı hatası:", err.stack);
  }
  // Zaman damgası eklemek raporun için teknik bir detay olur
  console.log(
    `🚀 Neon PostgreSQL Bağlantısı Başarılı: ${new Date().toLocaleDateString()}`,
  );
  release();
});

module.exports = pool;
