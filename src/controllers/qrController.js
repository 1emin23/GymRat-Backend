const pool = require("../config/db");

exports.checkIn = async (req, res) => {
  console.log("checkIn");
  const { booking_id } = req.body || {};
  const ownerId = req.user.id;
  let transactionStarted = false;

  try {
    const bookingId = Number(booking_id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Geçersiz rezervasyon!",
      });
    }

    const bookingResult = await pool.query(
      `SELECT b.id, b.status, b.booking_date, u.full_name
       FROM bookings b
       JOIN gyms g ON b.gym_id = g.id
       LEFT JOIN users u ON b.user_id = u.id
       WHERE b.id = $1 AND g.owner_id = $2
       LIMIT 1`,
      [bookingId, ownerId],
    );

    if (bookingResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Geçersiz rezervasyon!",
      });
    }

    const booking = bookingResult.rows[0];
    const bookingDate = new Date(booking.booking_date).toLocaleDateString().slice(0, 10);
    const today = new Date().toLocaleDateString().slice(0, 10);
    console.log("bookingDate", bookingDate, today);
    if (bookingDate !== today) {
      return res.status(400).json({
        success: false,
        message: "Bu rezervasyon bugüne ait değil!",
      });
    }

    const qrResult = await pool.query(
      "SELECT is_used FROM qr_codes WHERE booking_id = $1 LIMIT 1",
      [bookingId],
    );

    if (booking.status === "completed" || qrResult.rows[0]?.is_used === true) {
      return res.status(200).json({
        success: false,
        message: "Bu QR daha önce kullanıldı.",
      });
    }

    await pool.query("BEGIN");
    transactionStarted = true;

    await pool.query(
      "UPDATE bookings SET status = 'completed' WHERE id = $1",
      [bookingId],
    );
    await pool.query(
      "UPDATE qr_codes SET is_used = true, used_at = CURRENT_TIMESTAMP WHERE booking_id = $1",
      [bookingId],
    );

    await pool.query("COMMIT");
    transactionStarted = false;

    res.json({
      success: true,
      message: "Giriş başarılı!",
      user_name: booking.full_name || "",
    });
  } catch (err) {
    if (transactionStarted) {
      await pool.query("ROLLBACK");
    }
    console.error(err);
    res.status(500).json({ error: "Check-in işlemi başarısız." });
  }
};

exports.generateQR = async (req, res) => {
  try {
    const userId = req.user.id;

    const activeBooking = await pool.query(
      `SELECT id
       FROM bookings
       WHERE user_id = $1
         AND booking_date = CURRENT_DATE
         AND status = 'active'
       ORDER BY id DESC
       LIMIT 1`,
      [userId],
    );

    if (activeBooking.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Bugüne ait aktif rezervasyon bulunamadı.",
      });
    }

    const bookingId = activeBooking.rows[0].id;
    const qrToken = String(bookingId);
    const expiresAtResult = await pool.query(
      "SELECT date_trunc('day', NOW()) + interval '1 day' - interval '1 second' AS expires_at",
    );
    const expiresAt = expiresAtResult.rows[0].expires_at;

    await pool.query(
      `INSERT INTO qr_codes (booking_id, qr_token, expires_at, is_used, used_at)
       VALUES ($1, $2, $3, false, NULL)
       ON CONFLICT (booking_id) 
       DO UPDATE SET qr_token = EXCLUDED.qr_token, 
                     expires_at = EXCLUDED.expires_at,
                     is_used = false,
                     used_at = NULL`,
      [bookingId, qrToken, expiresAt],
    );

    res.json({ success: true, booking_id: bookingId, qr_token: qrToken });
  } catch (err) {
    console.error("generateQR error:", err);
    res.status(500).json({ error: "QR oluşturulamadı." });
  }
};
