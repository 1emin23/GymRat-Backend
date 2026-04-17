const express = require("express");
const cors = require("cors");
require("dotenv").config();

// db.js içindeki pool (bağlantı havuzu) yapısını çekiyoruz
const pool = require("./src/config/db");

const app = express();

// 1. Middlewares
app.use(cors()); // Farklı portlardan (örn: React 3000) gelen istekleri kabul etmek için
app.use(express.json()); // JSON formatındaki istek gövdelerini (body) okuyabilmek için

// 2. Database Connection Check
// Uygulama başlarken db.js zaten bağlantıyı test ediyor,
// ama burada pool üzerinden bir sorgu atarak doğruluğu kesinleştirebiliriz.
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ Veritabanı sorgu hatası:", err.stack);
  } else {
    console.log("✅ Veritabanı aktif, zaman damgası:", res.rows[0].now);
  }
});

// 3. Ana Route (Test için)
app.get("/", (req, res) => {
  res.json({ message: "GymWallet API Yayında!" });
});

// 4. Global Hata Yönetimi (Hata mesajlarını tek bir yerden kontrol edelim)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Bir sunucu hatası oluştu!",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});

// 5. Port Dinleme
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server http://localhost:${PORT} üzerinde çalışıyor.`);
});
