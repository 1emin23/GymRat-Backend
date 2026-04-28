const pool = require("../config/db");
const crypto = require("crypto");

const generateQR = async (req, res) => {
  const { booking_id } = req.body;
  const user_id = req.user.id;

  try {
    // 1. Rezervasyon kontrolü (Aktif mi ve kullanıcıya mı ait?)
    const bookingRes = await pool.query(
      "SELECT * FROM bookings WHERE id = $1 AND user_id = $2 AND status = 'active'",
      [booking_id, user_id],
    );

    if (bookingRes.rows.length === 0) {
      return res
        .status(403)
        .json({ message: "Geçersiz veya aktif olmayan rezervasyon." });
    }

    const booking = bookingRes.rows[0];
    const bookingDate = new Date(booking.booking_date);
    const now = new Date();

    // 30 dakika kuralı (Randevu günü ve saati kontrolü)
    const diffMs = bookingDate - now;
    const diffMins = Math.floor(diffMs / 60000);

    // Eğer randevu günü bugünse ve 30 dk kalmışsa (veya randevu saati içindeyse)
    if (diffMins > 30) {
      return res
        .status(400)
        .json({
          message: `QR kod randevuya 30 dakika kala oluşturulabilir. Kalan: ${diffMins} dk.`,
        });
    }

    // 2. Token oluştur ve Kaydet
    const qrToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 1000); // 30 saniye geçerli

    await pool.query(
      "INSERT INTO qr_codes (booking_id, qr_token, expires_at) VALUES ($1, $2, $3)",
      [booking_id, qrToken, expiresAt],
    );

    res.json({ success: true, qr_token: qrToken, expires_at: expiresAt });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "QR oluşturma hatası." });
  }
};

const verifyQR = async (req, res) => {
  const { qr_token } = req.body;
  const owner_id = req.user.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Token geçerliliği
    const qrRes = await client.query(
      "SELECT * FROM qr_codes WHERE qr_token = $1 AND is_used = false AND expires_at > NOW() FOR UPDATE",
      [qr_token],
    );

    if (qrRes.rows.length === 0) {
      throw new Error("Geçersiz veya süresi dolmuş QR kod.");
    }

    const qr = qrRes.rows[0];

    // 2. Salon Sahibi Yetki Kontrolü
    const gymRes = await client.query(
      "SELECT g.owner_id FROM gyms g JOIN bookings b ON g.id = b.gym_id WHERE b.id = $1",
      [qr.booking_id],
    );

    if (gymRes.rows[0].owner_id !== owner_id) {
      throw new Error("Bu salonun sahibi değilsiniz.");
    }

    // 3. İşlemleri Onayla
    await client.query(
      "UPDATE qr_codes SET is_used = true, used_at = NOW() WHERE id = $1",
      [qr.id],
    );
    await client.query(
      "UPDATE bookings SET status = 'completed', updated_at = NOW() WHERE id = $1",
      [qr.booking_id],
    );

    await client.query("COMMIT");
    res.json({ success: true, message: "Giriş onaylandı, antrenman başladı!" });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
};

module.exports = { generateQR, verifyQR };
