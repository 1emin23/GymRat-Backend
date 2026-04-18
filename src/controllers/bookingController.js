const pool = require("../config/db");

// @desc    Yeni Rezervasyon Oluştur (Cüzdan + Kota + Kayıt)
// @route   POST /api/bookings
// @access  Private (Sadece User)
const createBooking = async (req, res) => {
  const { gym_id, booking_date } = req.body;
  const user_id = req.user.id;

  const client = await pool.connect(); // Transaction için client üzerinden bağlanıyoruz

  try {
    await client.query("BEGIN"); // İŞLEM BAŞLASIN

    // 1. Günlük Konfigürasyonu Çek (Fiyat ve Kota Kontrolü)
    const configRes = await client.query(
      "SELECT * FROM gym_config WHERE gym_id = $1 AND target_date = $2 FOR UPDATE",
      [gym_id, booking_date],
    ); // FOR UPDATE ile bu satırı işlem bitene kadar kilitleriz (Race condition önlemi)

    if (configRes.rows.length === 0 || !configRes.rows[0].is_open) {
      throw new Error("Salon belirtilen tarihte kapalı veya ayarlanmamış.");
    }

    const config = configRes.rows[0];

    if (config.remaining_quota <= 0) {
      throw new Error("Maalesef bu tarih için kontenjan dolmuş.");
    }

    // 2. Kullanıcının Bakiyesini Kontrol Et
    const userRes = await client.query(
      "SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE",
      [user_id],
    );
    const userBalance = parseFloat(userRes.rows[0].wallet_balance);

    if (userBalance < parseFloat(config.price)) {
      throw new Error("Yetersiz bakiye. Lütfen cüzdanınıza para yükleyin.");
    }

    // 3. Kullanıcı Bakiyesini Düşür
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2",
      [config.price, user_id],
    );

    // 4. Salon Kotasını Azalt
    await client.query(
      "UPDATE gym_config SET remaining_quota = remaining_quota - 1 WHERE gym_id = $1 AND target_date = $2",
      [gym_id, booking_date],
    );

    // 5. Rezervasyonu Oluştur
    const bookingRes = await client.query(
      "INSERT INTO bookings (user_id, gym_id, booking_date, paid_amount, status) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [user_id, gym_id, booking_date, config.price, "active"],
    );

    // 6. Cüzdan Hareketlerine Log Ekle
    await client.query(
      "INSERT INTO wallet_transactions (user_id, booking_id, amount, type) VALUES ($1, $2, $3, $4)",
      [user_id, bookingRes.rows[0].id, -config.price, "payment"],
    );

    await client.query("COMMIT"); // HER ŞEY TAMAM, KAYDET!

    res.status(201).json({
      success: true,
      message: "Rezervasyon başarıyla oluşturuldu!",
      data: bookingRes.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK"); // BİR YERDE HATA OLURSA HER ŞEYİ GERİ AL!
    console.error("Booking Error:", error.message);
    res.status(400).json({ message: error.message });
  } finally {
    client.release(); // Bağlantıyı havuza geri bırak
  }
};

const checkInBooking = async (req, res) => {
  const { id } = req.params;
  const owner_id = req.user.id; // protect middleware'inden geliyor

  try {
    // 1. Bu rezervasyon gerçekten bu owner'ın salonuna mı ait?
    const bookingCheck = await pool.query(
      `SELECT b.* FROM bookings b
             JOIN gyms g ON b.gym_id = g.id
             WHERE b.id = $1 AND g.owner_id = $2`,
      [id, owner_id],
    );

    if (bookingCheck.rows.length === 0) {
      return res.status(403).json({
        message:
          "Bu onaylama işlemi için yetkiniz yok veya rezervasyon bulunamadı.",
      });
    }

    const booking = bookingCheck.rows[0];

    // 2. Rezervasyon zaten tamamlanmış mı kontrol et
    if (booking.status !== "active") {
      return res
        .status(400)
        .json({ message: `Rezervasyon zaten ${booking.status} durumunda.` });
    }

    // 3. Durumu güncelle
    const updatedBooking = await pool.query(
      "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
      ["completed", id],
    );

    res.json({
      success: true,
      message: "Check-in başarılı. Keyifli antrenmanlar!",
      data: updatedBooking.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Check-in sırasında bir hata oluştu." });
  }
};

module.exports = { createBooking, checkInBooking };
