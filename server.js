const express = require("express");
const cors = require("cors");
require("dotenv").config();
const passport = require("./src/config/passport");
const pool = require("./src/config/db");
const path = require("path");

const app = express();

// 1. Middlewares
app.use(
  cors({
    origin: "https://project-blueprint-builder-nine.vercel.app", // Test aşamasında her yerden gelen isteğe izin ver
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));
app.use(passport.initialize());

app.use("/users", express.static("public/users"));
app.use("/gyms", express.static("public/gyms")); // Lovable uyumlu yol

// 3. Veritabanı Bağlantı Kontrolü
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ Veritabanı sorgu hatası:", err.stack);
  } else {
    console.log("✅ Veritabanı aktif, zaman damgası:", res.rows[0].now);
  }
});

// 4. API Routes (Sıralama Önemlidir)

// Kimlik Doğrulama ve Kullanıcı İşlemleri
app.use("/api/auth", require("./src/routes/authRoutes"));
app.use("/api/users", require("./src/routes/userRoutes"));

// Salon ve Cüzdan İşlemleri
app.use("/api/gyms", require("./src/routes/gymRoutes.js"));
app.use("/api/wallet", require("./src/routes/walletRoutes"));

// Analiz ve Yorumlar
app.use("/api/analytics", require("./src/routes/analyticsRoutes"));
app.use("/api/reviews", require("./src/routes/reviewRoutes"));

// Rezervasyon ve QR Sistemi (Tek bir prefix altında birleşti)
// Önemli: bookingRoutes genel rezervasyon işlerini, qrRoutes ise QR üretimini yönetir.
app.use("/api/bookings", require("./src/routes/qrRoutes")); // önce spesifik
app.use("/api/bookings", require("./src/routes/bookingRoutes")); // sonra genel

// 5. Ana Route (Test için)
app.get("/", (req, res) => {
  res.send("GymWallet API Yayında!");
});

// 6. Global Hata Yönetimi
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Bir sunucu hatası oluştu!",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});

// 7. Port Dinleme
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running http://localhost:${PORT}`);
});
