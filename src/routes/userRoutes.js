const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const pool = require("../config/db");
const { sendOtpEmail } = require("../services/emailService");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// KYC belge yükleme ayarları
const kycStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user.id;
    const uploadDir = path.join(__dirname, "../../public/kyc", userId.toString());
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}${ext}`);
  },
});

const kycFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, and PDF files are allowed."), false);
  }
};

const uploadKyc = multer({
  storage: kycStorage,
  fileFilter: kycFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: "tax_plate", maxCount: 1 },
  { name: "business_license", maxCount: 1 },
  { name: "company_query", maxCount: 1 },
]);

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
      "SELECT id, full_name, email, role, wallet_balance, birth_date, phone, is_verified, approval_status, created_at FROM users WHERE id = $1",
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

    // Kullanıcının onay durumunu 'submitted' yap
    await pool.query(
      "UPDATE users SET approval_status = 'submitted' WHERE id = $1",
      [userId],
    );

    res.json({
      success: true,
      message: "Belgeler başarıyla gönderildi.",
      approval_status: "submitted",
    });
  } catch (error) {
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
