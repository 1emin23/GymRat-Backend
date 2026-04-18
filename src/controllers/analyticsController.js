const pool = require("../config/db");

// @desc    Salon sahibinin gelir ve rezervasyon istatistiklerini getir
// @route   GET /api/analytics/owner-summary
// @access  Private (Sadece Owner)
const getOwnerSummary = async (req, res) => {
  const owner_id = req.user.id;

  try {
    // 1. Toplam Gelir ve Toplam Rezervasyon Sayısı
    const summaryRes = await pool.query(
      `SELECT 
                COUNT(b.id) as total_bookings,
                SUM(b.paid_amount) as total_earnings
             FROM bookings b
             JOIN gyms g ON b.gym_id = g.id
             WHERE g.owner_id = $1 AND b.status = 'completed'`,
      [owner_id],
    );

    // 2. Salon bazlı performans (Eğer birden fazla salonu varsa)
    const gymPerformanceRes = await pool.query(
      `SELECT 
                g.name,
                COUNT(b.id) as booking_count,
                SUM(b.paid_amount) as gym_earnings
             FROM gyms g
             LEFT JOIN bookings b ON g.id = b.gym_id AND b.status = 'completed'
             WHERE g.owner_id = $1
             GROUP BY g.id`,
      [owner_id],
    );

    res.json({
      success: true,
      total_stats: summaryRes.rows[0],
      gym_performance: gymPerformanceRes.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Analiz verileri alınamadı." });
  }
};

module.exports = { getOwnerSummary };
