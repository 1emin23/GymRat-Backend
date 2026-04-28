const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const pool = require("../config/db");

// @desc    Kullanıcı kendi profilini görür
// @route   GET /api/users/profile
// @access  Private (Sadece giriş yapanlar)
router.get("/profile", protect, async (req, res) => {
  try {
    // req.user.id middleware'den geliyor. DB'den güncel veriyi çekelim
    const user = await pool.query(
      "SELECT id, full_name, email, role, wallet_balance, birth_date, phone, email_verified, phone_verified, created_at FROM users WHERE id = $1",
      [req.user.id],
    );

    console.log("Profile fetch successful for user:", req.user.id);

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
      "SELECT email, phone, email_verified, phone_verified FROM users WHERE id = $1",
      [userId],
    );

    if (currentUser.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const userData = currentUser.rows[0];
    let resetEmailVerification = false;
    let resetPhoneVerification = false;

    // Email değişiyorsa
    if (email && email !== userData.email) {
      const existingEmail = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND id != $2",
        [email, userId],
      );
      if (existingEmail.rows.length > 0) {
        return res.status(400).json({ message: "Bu email zaten kullanımda." });
      }
      resetEmailVerification = true;
    }

    // Telefon değişiyorsa
    if (phone && phone !== userData.phone) {
      resetPhoneVerification = true;
    }

    const updatedUser = await pool.query(
      `UPDATE users SET 
        full_name = COALESCE($1, full_name),
        email = COALESCE($2, email),
        birth_date = COALESCE($3, birth_date),
        phone = COALESCE($4, phone),
        email_verified = CASE WHEN $2 IS NOT NULL AND $2 != $5 THEN FALSE ELSE email_verified END,
        phone_verified = CASE WHEN $4 IS NOT NULL AND $4 != $6 THEN FALSE ELSE phone_verified END,
        email_verification_token = CASE WHEN $2 IS NOT NULL AND $2 != $5 THEN NULL ELSE email_verification_token END,
        phone_verification_token = CASE WHEN $4 IS NOT NULL AND $4 != $6 THEN NULL ELSE phone_verification_token END
      WHERE id = $7
      RETURNING id, full_name, email, role, wallet_balance, birth_date, phone, email_verified, phone_verified, created_at`,
      [
        full_name,
        email,
        birth_date,
        phone,
        userData.email,
        userData.phone,
        userId,
      ],
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const response = {
      success: true,
      message: "Profil başarıyla güncellendi.",
      user: updatedUser.rows[0],
    };

    if (resetEmailVerification || resetPhoneVerification) {
      response.verification_reset = {
        email: resetEmailVerification,
        phone: resetPhoneVerification,
      };
    }

    res.json(response);
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: "Profil güncellenirken hata oluştu." });
  }
});

// @desc    Telefon doğrulama kodu gönder (Profil sayfasından)
// @route   POST /api/users/send-phone-code
// @access  Private
router.post("/send-phone-code", protect, async (req, res) => {
  try {
    const { phone } = req.body;
    const userId = req.user.id;

    if (!phone) {
      return res.status(400).json({ message: "Telefon numarası gerekli." });
    }

    // Kullanıcının role'ü kontrol et
    const user = await pool.query("SELECT role FROM users WHERE id = $1", [
      userId,
    ]);
    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    // Verification code oluştur
    const phoneCode = Math.floor(100000 + Math.random() * 900000).toString();

    await pool.query(
      `UPDATE users SET phone_verification_token = $1 WHERE id = $2`,
      [phoneCode, userId],
    );

    // SMS gönder (şimdilik mock)
    console.log(`\n📱 [SMS] PHONE VERIFICATION`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Phone: ${phone}`);
    console.log(`   Code: ${phoneCode}`);
    console.log(`   Expires in: 15 minutes\n`);

    res.json({
      success: true,
      message: "Doğrulama kodu telefona gönderildi.",
      expires_in: "15 minutes",
    });
  } catch (error) {
    console.error("Send Phone Code Error:", error);
    res.status(500).json({ message: "Kod gönderilemedi." });
  }
});

// @desc    Telefon doğrula (Profil sayfasından)
// @route   POST /api/users/verify-phone
// @access  Private
router.post("/verify-phone", protect, async (req, res) => {
  try {
    const { phone, code } = req.body;
    const userId = req.user.id;

    if (!phone || !code) {
      return res.status(400).json({ message: "Telefon ve kod gerekli." });
    }

    const user = await pool.query(
      "SELECT id, phone_verification_token, phone_verified FROM users WHERE id = $1",
      [userId],
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    if (user.rows[0].phone_verified) {
      return res.status(400).json({ message: "Telefon zaten doğrulanmış." });
    }

    if (user.rows[0].phone_verification_token !== code) {
      return res.status(400).json({ message: "Yanlış doğrulama kodu." });
    }

    // Telefon doğrulaması tamamla
    await pool.query(
      `UPDATE users 
       SET phone_verified = TRUE,
           phone_verified_at = NOW(),
           phone_verification_token = NULL,
           phone = $1
       WHERE id = $2`,
      [phone, userId],
    );

    const verifiedUser = await pool.query(
      "SELECT id, full_name, email, role, phone, phone_verified FROM users WHERE id = $1",
      [userId],
    );

    res.json({
      success: true,
      message: "Telefon başarıyla doğrulandı.",
      user: verifiedUser.rows[0],
    });
  } catch (error) {
    console.error("Verify Phone Error:", error);
    res.status(500).json({ message: "Doğrulama başarısız." });
  }
});

// @desc    Email doğrulama kodu gönder (Profil sayfasından)
// @route   POST /api/users/send-email-code
// @access  Private
router.post("/send-email-code", protect, async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.id;

    if (!email) {
      return res.status(400).json({ message: "Email gerekli." });
    }

    // Email verification code oluştur
    const emailCode = Math.floor(100000 + Math.random() * 900000).toString();

    await pool.query(
      `UPDATE users SET email_verification_token = $1 WHERE id = $2`,
      [emailCode, userId],
    );

    // Email gönder (şimdilik mock)
    console.log(`\n📧 [EMAIL] EMAIL VERIFICATION`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Email: ${email}`);
    console.log(`   Code: ${emailCode}`);
    console.log(`   Expires in: 15 minutes\n`);

    res.json({
      success: true,
      message: "Doğrulama kodu email'e gönderildi.",
      expires_in: "15 minutes",
    });
  } catch (error) {
    console.error("Send Email Code Error:", error);
    res.status(500).json({ message: "Kod gönderilemedi." });
  }
});

// @desc    Email doğrula (Profil sayfasından)
// @route   POST /api/users/verify-email
// @access  Private
router.post("/verify-email", protect, async (req, res) => {
  try {
    const { email, code } = req.body;
    const userId = req.user.id;

    if (!email || !code) {
      return res.status(400).json({ message: "Email ve kod gerekli." });
    }

    const user = await pool.query(
      "SELECT id, email_verification_token, email_verified FROM users WHERE id = $1",
      [userId],
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    if (user.rows[0].email_verified) {
      return res.status(400).json({ message: "Email zaten doğrulanmış." });
    }

    if (user.rows[0].email_verification_token !== code) {
      return res.status(400).json({ message: "Yanlış doğrulama kodu." });
    }

    // Email doğrulaması tamamla
    await pool.query(
      `UPDATE users 
       SET email_verified = TRUE,
           email_verified_at = NOW(),
           email_verification_token = NULL,
           email = $1
       WHERE id = $2`,
      [email, userId],
    );

    const verifiedUser = await pool.query(
      "SELECT id, full_name, email, role, email_verified FROM users WHERE id = $1",
      [userId],
    );

    res.json({
      success: true,
      message: "Email başarıyla doğrulandı.",
      user: verifiedUser.rows[0],
    });
  } catch (error) {
    console.error("Verify Email Error:", error);
    res.status(500).json({ message: "Doğrulama başarısız." });
  }
});

module.exports = router;
