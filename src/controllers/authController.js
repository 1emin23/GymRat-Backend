const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendOtpEmail } = require("../services/emailService");

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Şifre değiştirme fonksiyonu
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id; // protect middleware'inden gelen kullanıcı id'si

  try {
    // 1. Kullanıcıyı database'den bul (Tablo adının 'users' olduğunu varsayıyorum)
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    if (!user.password_hash) {
      return res.status(400).json({
        message:
          "Bu hesap için şifre ayarlanmamış. Google ile giriş yaptıysanız şifre değiştirilemez.",
      });
    }

    // 2. Mevcut şifreyi kontrol et
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Mevcut şifreniz hatalı." });
    }

    // 3. Yeni şifreyi hashle
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // 4. Veritabanında güncelle
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    return res.status(200).json({ message: "Şifre başarıyla güncellendi." });
  } catch (error) {
    console.error("Change Password Error:", error);
    return res.status(500).json({ message: "Sunucu hatası oluştu." });
  }
};

// ==================== REGISTER ====================
const register = async (req, res) => {
  console.log("Register başladı");
  const { full_name, email, password, role, birth_date, phone } = req.body;

  try {
    // 1. Email zaten kullanılıyor mu kontrol et
    const userExists = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: "Bu email zaten kullanımda." });
    }

    // 3. Şifreyi hashle
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 5. Veritabanına kaydet (is_verified = false)
    const newUser = await pool.query(
      `INSERT INTO users
   (full_name, email, password_hash, role, birth_date, phone, is_verified)
   VALUES ($1, $2, $3, $4, $5, $6, FALSE)
   RETURNING id, full_name, email, role, is_verified`,
      [full_name, email, password_hash, role || "user", birth_date, phone],
    );
    const user = newUser.rows[0];

    // Yeni kullanıcıya otomatik OTP gönder
    const otpCode = generateOtp();
    console.log(`[TEST OTP] Email: ${user.email} | Kod: ${otpCode}`);
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 dakika
    await pool.query(
      "UPDATE users SET otp_code = $1, otp_expires_at = $2, otp_sent_at = NOW() WHERE id = $3",
      [otpCode, otpExpiresAt, user.id]
    );
    await sendOtpEmail(user.email, otpCode);

    return res.json({
      success: true,
      message: "Kayıt başarılı. Lütfen e-posta adresinize gönderilen doğrulama kodunu girin.",
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, is_verified: user.is_verified },
    });
  } catch (error) {
    console.error("Register Hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
};

// ==================== LOGIN ====================
const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await pool.query(
      `SELECT id, full_name, email, password_hash, role, is_verified
       FROM users WHERE email = $1`,
      [email],
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: "Kullanıcı bulunamadı." });
    }

    const user = userResult.rows[0];

    if (!user.password_hash) {
      return res.status(400).json({
        message:
          "Bu hesap için şifre bulunmuyor. Lütfen Google ile giriş yapın.",
      });
    }

    // Şifre eşleşiyor mu?
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Hatalı şifre." });
    }

    // E-posta doğrulanmamışsa girişe izin verme
    if (!user.is_verified) {
      return res.status(403).json({
        message: "E-posta adresiniz doğrulanmamış. Lütfen e-postanıza gönderilen kodu girin.",
        needsVerification: true,
        email: user.email,
      });
    }

    // Token oluştur
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res.json({
      success: true,
      token,
      user: { id: user.id, full_name: user.full_name, role: user.role, is_verified: user.is_verified },
    });
  } catch (error) {
    console.error("Login Hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
};

module.exports = {
  register,
  login,
  changePassword,
};
