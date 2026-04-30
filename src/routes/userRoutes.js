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
      "SELECT id, full_name, email, role, wallet_balance, birth_date, phone, created_at FROM users WHERE id = $1",
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
      "SELECT email, phone FROM users WHERE id = $1",
      [userId],
    );
    if (currentUser.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const userData = currentUser.rows[0];

    // Email değişiyorsa
    if (email && email !== userData.email) {
      const existingEmail = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND id != $2",
        [email, userId],
      );
      if (existingEmail.rows.length > 0) {
        return res.status(400).json({ message: "Bu email zaten kullanımda." });
      }
    }

    const updatedUser = await pool.query(
      `UPDATE users SET 
        full_name = COALESCE($1, full_name),
        email = COALESCE($2, email),
        birth_date = COALESCE($3, birth_date),
        phone = COALESCE($4, phone)
      WHERE id = $5
      RETURNING id, full_name, email, role, wallet_balance, birth_date, phone, created_at`,
      [full_name, email, birth_date, phone, userId],
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
