const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const register = async (req, res) => {
  console.log("register calsıtı");
  const { full_name, email, password, role, birth_date } = req.body;

  try {
    // 1. Kullanıcı var mı kontrol et
    const userExists = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email],
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: "Bu email zaten kullanımda." });
    }

    // 2. Şifreyi hashle
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 3. Veritabanına ekle (Tablondaki kolon isimlerine birebir uyumlu)
    const newUser = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role, birth_date) VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, role",
      [full_name, email, password_hash, role || "user", birth_date],
    );

    res.status(201).json({
      success: true,
      user: newUser.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Sunucu hatası." });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email],
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: "Kullanıcı bulunamadı." });
    }

    const user = userResult.rows[0];
    console.log("DB'den gelen kullanıcı:", user.email); // Debug

    // DİKKAT: Tablonda 'password_hash' olarak tanımlamıştın.
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      console.log("Şifre eşleşmedi!"); // Debug
      return res.status(400).json({ message: "Hatalı şifre." });
    }

    if (!process.env.JWT_SECRET) {
      console.error("HATA: JWT_SECRET .env dosyasında tanımlı değil!");
      return res.status(500).json({ message: "Sunucu yapılandırma hatası." });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, full_name: user.full_name, role: user.role },
    });
  } catch (error) {
    console.error("Login Hatası Detayı:", error); // Terminale asıl hatayı basar
    res.status(500).json({ message: "Sunucu hatası.", detayı: error.message });
  }
};

module.exports = { register, login };
