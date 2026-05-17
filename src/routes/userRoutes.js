const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const pool = require("../config/db");
const { sendOtpEmail } = require("../services/emailService");
const { uploadKyc } = require("../utils/fileUpload");
const multer = require("multer");
const path = require("path");

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
      `SELECT 
        u.id, u.full_name, u.email, u.role, u.wallet_balance, 
        u.birth_date, u.phone, u.is_verified, u.approval_status, u.created_at,
        ks.rejection_reason,
        ks.submission_count
      FROM users u
      LEFT JOIN kyc_submissions ks ON ks.user_id = u.id
      WHERE u.id = $1`,
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
      RETURNING id, full_name, email, role, wallet_balance, birth_date, phone, is_verified, approval_status, created_at`,
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

// @desc    İşletme sahibi KYC belgelerini yükle (Vergi Levhası, Ruhsat, Şirket Sorgulama)
// @route   POST /api/users/kyc
// @access  Private (Sadece giriş yapan işletme sahipleri)
router.post("/kyc", protect, uploadKyc, async (req, res) => {
  try {
    const userId = req.user.id;
    const files = req.files;

    if (
      !files ||
      !files.tax_plate ||
      !files.business_license ||
      !files.company_query
    ) {
      return res.status(400).json({
        success: false,
        message: "Lütfen tüm 3 zorunlu belgeyi yükleyin.",
      });
    }

    const taxPlatePath = files.tax_plate[0].path;
    const businessLicensePath = files.business_license[0].path;
    const companyQueryPath = files.company_query[0].path;

    await pool.query("BEGIN");

    // Check if existing submission exists
    const existing = await pool.query(
      "SELECT id FROM kyc_submissions WHERE user_id = $1",
      [userId],
    );

    if (existing.rows.length > 0) {
      // Update existing (overwrite)
      await pool.query(
        `UPDATE kyc_submissions SET
          tax_plate_path = $1,
          business_license_path = $2,
          company_query_path = $3,
          status = 'submitted',
          submitted_at = NOW(),
          reviewed_by = NULL,
          reviewed_at = NULL,
          rejection_reason = NULL,
          submission_count = submission_count + 1
        WHERE user_id = $4`,
        [taxPlatePath, businessLicensePath, companyQueryPath, userId],
      );
    } else {
      // New submission
      await pool.query(
        `INSERT INTO kyc_submissions
          (user_id, tax_plate_path, business_license_path, company_query_path, status, submitted_at, submission_count)
        VALUES ($1, $2, $3, $4, 'submitted', NOW(), 1)`,
        [userId, taxPlatePath, businessLicensePath, companyQueryPath],
      );
    }

    // Update users table
    await pool.query(
      "UPDATE users SET approval_status = 'submitted' WHERE id = $1",
      [userId],
    );

    await pool.query("COMMIT");

    res.json({
      success: true,
      message: "Belgeler başarıyla gönderildi.",
      approval_status: "submitted",
    });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("KYC Submit Error:", error);
    res.status(500).json({
      success: false,
      message: "Belge gönderilirken bir hata oluştu.",
      error: error.message,
    });
  }
});

// Multer hata yakalama middleware'i
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Dosya çok büyük. Maksimum 5MB olmalıdır.",
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
  if (err && err.message) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
  next(err);
});

module.exports = router;
