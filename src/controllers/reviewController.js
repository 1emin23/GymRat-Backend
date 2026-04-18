const pool = require("../config/db");

// @desc    Salona yorum ve puan bırak
// @route   POST /api/reviews
// @access  Private
const addReview = async (req, res) => {
  const { gym_id, rating, comment } = req.body;
  const user_id = req.user.id;

  try {
    // 1. Kullanıcı bu salona gerçekten gitmiş mi? (completed rezervasyon kontrolü)
    const checkBooking = await pool.query(
      "SELECT * FROM bookings WHERE user_id = $1 AND gym_id = $2 AND status = 'completed' LIMIT 1",
      [user_id, gym_id],
    );

    if (checkBooking.rows.length === 0) {
      return res.status(403).json({
        message:
          "Sadece hizmeti tamamladığınız salonlara yorum yapabilirsiniz.",
      });
    }

    // 2. Yorumu kaydet
    const newReview = await pool.query(
      "INSERT INTO reviews (user_id, gym_id, rating, comment) VALUES ($1, $2, $3, $4) RETURNING *",
      [user_id, gym_id, rating, comment],
    );

    res.status(201).json({
      success: true,
      message: "Yorumunuz için teşekkürler!",
      data: newReview.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Yorum kaydedilirken bir hata oluştu." });
  }
};

module.exports = { addReview };
