const pool = require("../config/db");

// @desc    Bir salona ait tüm yorumları getir
// @route   GET /api/reviews/gym/:gymId
// @access  Public
const getReviewsByGym = async (req, res) => {
  const { gymId } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
         r.id, r.user_id, r.gym_id, r.booking_id, r.rating, r.comment,
         r.created_at, r.updated_at,
         u.full_name as user_name,
         b.booking_date
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       JOIN bookings b ON r.booking_id = b.id
       WHERE r.gym_id = $1
       ORDER BY r.created_at DESC`,
      [gymId]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Get Reviews Error:", error);
    res.status(500).json({ message: "Yorumlar getirilirken bir hata oluştu." });
  }
};

// @desc    Salona yorum ve puan bırak
// @route   POST /api/reviews
// @access  Private
const addReview = async (req, res) => {
  const { gym_id, booking_id, rating, comment } = req.body;
  const user_id = req.user.id;

  if (!gym_id || !booking_id || !rating) {
    return res.status(400).json({
      message: "gym_id, booking_id ve rating zorunludur.",
    });
  }

  try {
    // 1. Seçilen rezervasyon bu kullanıcıya mı ait ve tamamlanmış mı?
    const bookingCheck = await pool.query(
      `SELECT * FROM bookings 
       WHERE id = $1 AND user_id = $2 AND gym_id = $3 AND status = 'completed'`,
      [booking_id, user_id, gym_id]
    );

    if (bookingCheck.rows.length === 0) {
      return res.status(403).json({
        message:
          "Sadece hizmeti tamamladığınız salonlara yorum yapabilirsiniz.",
      });
    }

    const bookingDate = bookingCheck.rows[0].booking_date;

    // 2. Bu tarih için zaten yorum yapılmış mı?
    const existingReview = await pool.query(
      `SELECT r.id 
       FROM reviews r
       JOIN bookings b ON r.booking_id = b.id
       WHERE r.user_id = $1 AND r.gym_id = $2 AND b.booking_date = $3`,
      [user_id, gym_id, bookingDate]
    );

    if (existingReview.rows.length > 0) {
      return res.status(409).json({
        message: "Bu tarih için zaten yorum yaptınız.",
      });
    }

    // 3. Yorumu kaydet
    const newReview = await pool.query(
      `INSERT INTO reviews (user_id, gym_id, booking_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, gym_id, booking_id, rating, comment || ""]
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

// @desc    Yorumu güncelle (metin ve/veya puan)
// @route   PATCH /api/reviews/:id
// @access  Private
const updateReview = async (req, res) => {
  const { id } = req.params;
  const { comment, rating } = req.body;
  const user_id = req.user.id;

  if (comment === undefined && rating === undefined) {
    return res.status(400).json({ message: "comment veya rating alanı zorunludur." });
  }

  if (rating !== undefined && (rating < 1 || rating > 5)) {
    return res.status(400).json({ message: "rating 1 ile 5 arasında olmalıdır." });
  }

  try {
    const check = await pool.query(
      "SELECT * FROM reviews WHERE id = $1 AND user_id = $2",
      [id, user_id]
    );

    if (check.rows.length === 0) {
      return res.status(403).json({
        message: "Bu yorumu düzenleme yetkiniz yok.",
      });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (comment !== undefined) {
      fields.push(`comment = $${idx++}`);
      values.push(comment);
    }
    if (rating !== undefined) {
      fields.push(`rating = $${idx++}`);
      values.push(rating);
    }
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE reviews 
       SET ${fields.join(", ")} 
       WHERE id = $${idx} 
       RETURNING *`,
      values
    );

    res.json({
      success: true,
      message: "Yorum güncellendi.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Yorum güncellenirken bir hata oluştu." });
  }
};

// @desc    Yorumu sil
// @route   DELETE /api/reviews/:id
// @access  Private
const deleteReview = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const check = await pool.query(
      "SELECT * FROM reviews WHERE id = $1 AND user_id = $2",
      [id, user_id]
    );

    if (check.rows.length === 0) {
      return res.status(403).json({
        message: "Bu yorumu silme yetkiniz yok.",
      });
    }

    await pool.query("DELETE FROM reviews WHERE id = $1", [id]);

    res.json({
      success: true,
      message: "Yorum silindi.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Yorum silinirken bir hata oluştu." });
  }
};

module.exports = {
  getReviewsByGym,
  addReview,
  updateReview,
  deleteReview,
};
