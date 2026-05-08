const pool = require("../config/db");
const crypto = require("crypto");

const QR_TTL_MS = 30 * 1000;
const QR_SECRET = process.env.QR_SECRET_KEY || "gymwallet_fallback_secret";

function computeSignature(bookingId, timestamp) {
  return crypto
    .createHmac("sha256", QR_SECRET)
    .update(`${bookingId}:${timestamp}`)
    .digest("hex");
}

exports.checkIn = async (req, res) => {
  const { token } = req.body || {};
  const owner_id = req.user.id;
  let transactionStarted = false;

  try {
    if (!token || typeof token !== "string") {
      return res.status(400).json({
        success: false,
        reason: "invalid",
        message: "Geçersiz QR formatı.",
      });
    }

    const parts = token.split(":");
    if (parts.length !== 3) {
      return res.status(400).json({
        success: false,
        reason: "invalid",
        message: "QR formatı hatalı.",
      });
    }

    const [bookingIdRaw, timestampRaw, signature] = parts;
    const bookingId = Number(bookingIdRaw);
    const timestamp = Number(timestampRaw);

    if (!Number.isInteger(bookingId) || !Number.isFinite(timestamp) || !signature) {
      return res.status(400).json({
        success: false,
        reason: "invalid",
        message: "QR içeriği doğrulanamadı.",
      });
    }

    // 1) İmza doğrulama
    const expectedSignature = computeSignature(bookingId, timestamp);

    if (signature !== expectedSignature) {
      return res.status(400).json({
        success: false,
        reason: "invalid",
        message: "Geçersiz QR kodu.",
      });
    }

    // 2) Süre doğrulama
    if (Date.now() - timestamp > QR_TTL_MS) {
      return res.status(400).json({
        success: false,
        reason: "expired",
        message: "QR kodun süresi dolmuş.",
      });
    }

    // 3) Token DB'de var mı, doğru booking'e mi ait, kullanılmamış mı?
    const qrResult = await pool.query(
      `SELECT booking_id, qr_token, expires_at, is_used
       FROM qr_codes
       WHERE booking_id = $1`,
      [bookingId],
    );

    if (qrResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        reason: "invalid",
        message: "QR kaydı bulunamadı.",
      });
    }

    const qrRow = qrResult.rows[0];

    if (qrRow.qr_token !== token) {
      return res.status(400).json({
        success: false,
        reason: "invalid",
        message: "QR kodu güncel değil.",
      });
    }

    if (qrRow.is_used) {
      return res.status(200).json({
        success: false,
        reason: "already_used",
        message: "Bu QR daha önce kullanıldı.",
      });
    }

    if (qrRow.expires_at && new Date(qrRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        reason: "expired",
        message: "QR kodun süresi dolmuş.",
      });
    }

    // 4) Salon sahibi kontrolü ve kullanıcı adı çekme
    const gymCheck = await pool.query(
      `SELECT g.owner_id, u.full_name 
             FROM bookings b 
             JOIN gyms g ON b.gym_id = g.id 
             JOIN users u ON b.user_id = u.id 
             WHERE b.id = $1`,
      [bookingId],
    );

    if (!gymCheck.rows[0]) {
      return res.status(400).json({
        success: false,
        reason: "invalid",
        message: "Rezervasyon bulunamadı.",
      });
    }

    if (gymCheck.rows[0].owner_id !== owner_id) {
      return res
        .status(403)
        .json({ error: "Bu salonun yetkilisi değilsiniz!" });
    }

    // 5) Onaylama (Transaction)
    await pool.query("BEGIN");
    transactionStarted = true;
    await pool.query(
      "UPDATE qr_codes SET is_used = true, used_at = NOW() WHERE booking_id = $1",
      [bookingId],
    );
    await pool.query(
      "UPDATE bookings SET status = 'completed', is_used = true WHERE id = $1",
      [bookingId],
    );
    await pool.query("COMMIT");
    transactionStarted = false;

    res.json({
      success: true,
      message: "Giriş Onaylandı",
      user_name: gymCheck.rows[0].full_name,
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

    // Yeni token üret (id:timestamp:signature)
    const timestamp = Date.now();
    const expiresAt = new Date(timestamp + QR_TTL_MS);
    const signature = computeSignature(id, timestamp);
    const qrToken = `${id}:${timestamp}:${signature}`;

    // UPSERT — booking_id üzerinde tek kayıt tut, tokeni 30 sn ömürle güncelle
    await pool.query(
      `INSERT INTO qr_codes (booking_id, qr_token, expires_at, is_used, used_at)
       VALUES ($1, $2, $3, false, NULL)
       ON CONFLICT (booking_id) 
       DO UPDATE SET qr_token = EXCLUDED.qr_token, 
                     expires_at = EXCLUDED.expires_at,
                     is_used = false,
                     used_at = NULL`,
      [id, qrToken, expiresAt],
    );

    res.json({ qr_token: qrToken, expires_at: expiresAt });
  } catch (err) {
    console.error("generateQR error:", err);
    res.status(500).json({ error: "QR oluşturulamadı." });
  }
};
