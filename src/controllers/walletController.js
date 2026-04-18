const pool = require("../config/db");

// @desc    Cüzdana bakiye yükle (Simülasyon)
// @route   POST /api/wallet/deposit
// @access  Private
const depositMoney = async (req, res) => {
  const { amount } = req.body;
  const user_id = req.user.id;

  if (amount <= 0) return res.status(400).json({ message: "Geçersiz miktar." });

  try {
    await pool.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
      [amount, user_id],
    );

    await pool.query(
      "INSERT INTO wallet_transactions (user_id, amount, type) VALUES ($1, $2, $3)",
      [user_id, amount, "deposit"],
    );

    res.json({ success: true, message: `${amount}₺ başarıyla yüklendi.` });
  } catch (error) {
    res.status(500).json({ message: "Yükleme işlemi başarısız." });
  }
};

// @desc    Cüzdan özetini ve geçmişi getir
// @route   GET /api/wallet/summary
const getWalletSummary = async (req, res) => {
  const user_id = req.user.id;
  try {
    const userRes = await pool.query(
      "SELECT wallet_balance FROM users WHERE id = $1",
      [user_id],
    );
    const transactionsRes = await pool.query(
      `SELECT wt.*, g.name as gym_name 
             FROM wallet_transactions wt
             LEFT JOIN bookings b ON wt.booking_id = b.id
             LEFT JOIN gyms g ON b.gym_id = g.id
             WHERE wt.user_id = $1
             ORDER BY wt.created_at DESC`,
      [user_id],
    );

    res.json({
      success: true,
      balance: userRes.rows[0].wallet_balance,
      history: transactionsRes.rows,
    });
  } catch (error) {
    res.status(500).json({ message: "Cüzdan bilgileri alınamadı." });
  }
};

module.exports = { depositMoney, getWalletSummary };
