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
      "SELECT id, full_name, email, role, wallet_balance, birth_date FROM users WHERE id = $1",
      [req.user.id],
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    res.json({
      success: true,
      user: user.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: "Sunucu hatası." });
  }
});

module.exports = router;
