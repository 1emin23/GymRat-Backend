const pool = require("../config/db");
const crypto = require("crypto");

exports.checkIn = async (req, res) => {
  const { token } = req.body;
  const owner_id = req.user.id;

  try {
    const [bookingId, timestamp, signature] = token.split(":");
    const secret = process.env.QR_SECRET_KEY;

    // 1. İmza ve Zaman Kontrolü
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${bookingId}:${timestamp}`)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(401).json({ error: "Geçersiz QR Kod (İmza Hatası)!" });
    }

    if (Date.now() - parseInt(timestamp) > 30000) {
      return res.status(401).json({ error: "QR Kodun süresi dolmuş!" });
    }

    // 2. Token DB'de var mı ve kullanılmamış mı?
    const qrResult = await pool.query(
      "SELECT * FROM qr_codes WHERE qr_token = $1 AND is_used = false",
      [token],
    );

    if (qrResult.rows.length === 0) {
      return res.status(401).json({ error: "Bu kod zaten kullanılmış!" });
    }

    // 3. Salon Sahibi Kontrolü ve Kullanıcı Adı Çekme
    const gymCheck = await pool.query(
      `SELECT g.owner_id, u.full_name 
             FROM bookings b 
             JOIN gyms g ON b.gym_id = g.id 
             JOIN users u ON b.user_id = u.id 
             WHERE b.id = $1`,
      [bookingId],
    );

    if (gymCheck.rows[0].owner_id !== owner_id) {
      return res
        .status(403)
        .json({ error: "Bu salonun yetkilisi değilsiniz!" });
    }

    // 4. Onaylama (Transaction)
    await pool.query("BEGIN");
    await pool.query(
      "UPDATE qr_codes SET is_used = true, used_at = NOW() WHERE qr_token = $1",
      [token],
    );
    await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [
      bookingId,
    ]);
    await pool.query("COMMIT");

    res.json({
      success: true,
      message: "Giriş Onaylandı",
      user_name: gymCheck.rows[0].full_name,
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Check-in işlemi başarısız." });
  }
};

exports.generateQR = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Booking sahibi mi + bugün mü + aktif mi kontrol
    const { rows } = await pool.query(
      `SELECT id, user_id, booking_date, status 
       FROM bookings WHERE id = $1`,
      [id],
    );
    const booking = rows[0];
    if (!booking)
      return res.status(404).json({ error: "Rezervasyon bulunamadı." });
    if (Number(booking.user_id) !== Number(userId)) {
      console.log(`userId: ${userId}, booking.user_id: ${booking.user_id}`);
      return res.status(403).json({ error: "Yetkisiz." });
    }
    if (booking.status !== "active") {
      return res.status(400).json({ error: "Bu rezervasyon aktif değil." });
    }

    // Bugün kontrolü (TZ'ye dikkat!)
    const today = new Date().toLocaleDateString().slice(0, 10);
    const bDate = new Date(booking.booking_date)
      .toLocaleDateString()
      .slice(0, 10);
    if (bDate !== today) {
      return res
        .status(400)
        .json({ error: "QR yalnızca rezervasyon gününde oluşturulabilir." });
    }

    // Zaten kullanılmış mı?
    const used = await pool.query(
      `SELECT is_used FROM qr_codes WHERE booking_id = $1 AND is_used = true LIMIT 1`,
      [id],
    );
    if (used.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "Bu rezervasyon için giriş zaten yapıldı." });
    }

    // Yeni token üret
    const timestamp = Date.now();
    const expiresAt = new Date(timestamp + 30 * 1000); // 30s
    const signature = crypto
      .createHmac("sha256", process.env.QR_SECRET || "qr_secret")
      .update(`${id}:${timestamp}`) // ← checkIn ile AYNI format (kolon!)
      .digest("hex");
    const qrToken = `${id}:${timestamp}:${signature}`;

    // ✅ UPSERT — eski kullanılmamış kaydı yenile, yoksa ekle
    await pool.query(
      `INSERT INTO qr_codes (booking_id, qr_token, expires_at, is_used, used_at)
       VALUES ($1, $2, $3, false, NULL)
       ON CONFLICT (booking_id) 
       DO UPDATE SET qr_token = EXCLUDED.qr_token, 
                     expires_at = EXCLUDED.expires_at,
                     is_used = false,
                     used_at = NULL
       WHERE qr_codes.is_used = false`,
      [id, qrToken, expiresAt],
    );

    res.json({ qr_token: qrToken, expires_at: expiresAt });
  } catch (err) {
    console.error("generateQR error:", err);
    res.status(500).json({ error: "QR oluşturulamadı." });
  }
};
