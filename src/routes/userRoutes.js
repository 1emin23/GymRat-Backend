const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const pool = require("../config/db");
const { sendOtpEmail } = require("../services/emailService");

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// @desc    Kullanıcı kendi profilini görür
// @route   GET /api/users/profile
// @access  Private (Sadece giriş yapanlar)
router.get("/profile", protect, async (req, res) => {
  try {
    // req.user.id middleware'den geliyor. DB'den güncel veriyi çekelim
    const user = await pool.query(
      "SELECT id, full_name, email, role, wallet_balance, birth_date, phone, is_verified, created_at FROM users WHERE id = $1",
      [req.user.id],
    );

    console.log(
      "Profile fetch successful for user in the userRoutes:",
      req.user.id,
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    res.json({
      success: true,
      user: user.rows[0],
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ message: "Sunucu hatası.", error: error.message });
  }
});

// @desc    Kullanıcı profil bilgilerini güncelle
// @route   PATCH /api/users/profile
// @access  Private (Sadece giriş yapanlar)
router.patch("/profile", protect, async (req, res) => {
  try {
    const { full_name, email, birth_date, phone } = req.body;
    const userId = req.user.id;

    // Mevcut kullanıcı bilgilerini al
    const currentUser = await pool.query(
      "SELECT email, phone FROM users WHERE id = $1",
      [userId],
    );
    if (currentUser.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const userData = currentUser.rows[0];
    const emailChanged =
      email && email.toLowerCase() !== userData.email.toLowerCase();

    // Email değişiyorsa
    if (emailChanged) {
      // Başka kullanıcıda var mı kontrol et (hem email hem pending_email)
      const existingEmail = await pool.query(
        "SELECT id FROM users WHERE (email = $1 OR pending_email = $1) AND id != $2",
        [email.toLowerCase(), userId],
      );
      if (existingEmail.rows.length > 0) {
        return res.status(400).json({ message: "Bu email zaten kullanımda." });
      }

      // OTP üret
      const otpCode = generateOtp();
      console.log(`[TEST OTP] Email: ${email} | Kod: ${otpCode}`);
      const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 dakika

      // pending_email'e yaz, is_verified false yap, diğer alanları güncelle
      await pool.query(
        `UPDATE users SET
          full_name = COALESCE($1, full_name),
          phone = COALESCE($2, phone),
          pending_email = $3,
          is_verified = FALSE,
          otp_code = $4,
          otp_expires_at = $5,
          otp_sent_at = NOW()
        WHERE id = $6`,
        [full_name, phone, email.toLowerCase(), otpCode, otpExpiresAt, userId],
      );

      await sendOtpEmail(email, otpCode);

      return res.json({
        success: true,
        message:
          "E-posta değişikliği için doğrulama kodu gönderildi. Lütfen yeni e-posta adresinize gelen kodu girin.",
        needsVerification: true,
        email: email.toLowerCase(),
      });
    }

    // Email değişmiyorsa normal güncelleme
    const updatedUser = await pool.query(
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        birth_date = COALESCE($2, birth_date),
        phone = COALESCE($3, phone)
      WHERE id = $4
      RETURNING id, full_name, email, role, wallet_balance, birth_date, phone, is_verified, created_at`,
      [full_name, birth_date, phone, userId],
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const response = {
      success: true,
      message: "Profil başarıyla güncellendi.",
      user: updatedUser.rows[0],
    };

    res.json(response);
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: "Profil güncellenirken hata oluştu." });
  }
});

module.exports = router;
