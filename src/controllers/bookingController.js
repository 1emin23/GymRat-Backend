const pool = require("../config/db");

// @desc    Rezervasyonları Getir (User: kendi rezevasyonları, Owner: salon rezevasyonları)
// @route   GET /api/bookings
// @access  Private
const getBookings = async (req, res) => {
  const user_id = req.user.id;
  const role = req.user.role;

  try {
    let bookings;

    if (role === "owner") {
      bookings = await pool.query(
        `SELECT b.id, b.user_id, b.gym_id, b.booking_date, b.paid_amount, b.status, b.created_at,
                g.name as gym_name, u.full_name, u.email
         FROM bookings b
         JOIN gyms g ON b.gym_id = g.id
         JOIN users u ON b.user_id = u.id
         WHERE g.owner_id = $1
         ORDER BY b.booking_date DESC`,
        [user_id],
      );
    } else {
      bookings = await pool.query(
        `SELECT b.id, b.user_id, b.gym_id, b.booking_date, b.paid_amount, b.status, b.created_at, g.name as gym_name
         FROM bookings b
         JOIN gyms g ON b.gym_id = g.id
         WHERE b.user_id = $1
         ORDER BY b.booking_date DESC`,
        [user_id],
      );
    }

    res.json({
      success: true,
      data: bookings.rows,
    });
  } catch (error) {
    console.error("Get Bookings Error:", error);
    res.status(500).json({
      message: "Rezervasyonlar getirilirken hata oluştu.",
      error: error.message,
    });
  }
};
// @desc    Yeni Rezervasyon Oluştur (Cüzdan + Kota + Kayıt) - Çoklu Tarih Desteği
// @route   POST /api/bookings
// @access  Private (Sadece User)
const createBooking = async (req, res) => {
  const { gym_id, booking_date, booking_dates } = req.body;
  const user_id = req.user.id;

  // Tek tarih mi yoksa çoklu tarih mi kontrol et
  const datesToBook =
    booking_dates && Array.isArray(booking_dates)
      ? booking_dates
      : booking_date
        ? [booking_date]
        : [];

  if (datesToBook.length === 0) {
    return res.status(400).json({ message: "Lütfen en az bir tarih seçin" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const createdBookings = [];
    let totalCost = 0;

    // Her tarih için kontrolü yap ve hazırlığı tamamla
    const bookingDetails = [];

    for (const date of datesToBook) {
      const configRes = await client.query(
        "SELECT * FROM gym_config WHERE gym_id = $1 AND target_date = $2 FOR UPDATE",
        [gym_id, date],
      );

      if (configRes.rows.length === 0 || !configRes.rows[0].is_open) {
        throw new Error(`Salon ${date} tarihinde kapalı veya ayarlanmamış.`);
      }

      const config = configRes.rows[0];

      if (config.remaining_quota <= 0) {
        throw new Error(`${date} tarihinde kontenjan dolmuş.`);
      }

      bookingDetails.push({
        date,
        price: parseFloat(config.price),
        quota_id: config.id,
      });

      totalCost += parseFloat(config.price);
    }

    // 2. Kullanıcının toplam bakiyesini kontrol et
    const userRes = await client.query(
      "SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE",
      [user_id],
    );
    const userBalance = parseFloat(userRes.rows[0].wallet_balance);

    if (userBalance < totalCost) {
      throw new Error(
        `Yetersiz bakiye. Gerekli: ₺${totalCost.toFixed(2)}, Mevcut: ₺${userBalance.toFixed(2)}`,
      );
    }

    // 3. Her tarih için rezervasyon oluştur
    for (const detail of bookingDetails) {
      // Bakiye düş
      await client.query(
        "UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2",
        [detail.price, user_id],
      );

      // Kota azalt
      await client.query(
        "UPDATE gym_config SET remaining_quota = remaining_quota - 1 WHERE gym_id = $1 AND target_date = $2",
        [gym_id, detail.date],
      );

      // Rezervasyon oluştur
      const bookingRes = await client.query(
        "INSERT INTO bookings (user_id, gym_id, booking_date, paid_amount, status) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [user_id, gym_id, detail.date, detail.price, "active"],
      );

      // Cüzdan hareketi kaydet
      await client.query(
        "INSERT INTO wallet_transactions (user_id, booking_id, amount, type) VALUES ($1, $2, $3, $4)",
        [user_id, bookingRes.rows[0].id, -detail.price, "payment"],
      );

      createdBookings.push(bookingRes.rows[0]);
    }

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: `${createdBookings.length} rezervasyon başarıyla oluşturuldu!`,
      data: createdBookings,
      total_cost: totalCost,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Booking Error:", error.message);
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
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

// @desc    Rezervasyonu İptal Et (Kısmen veya Tam İade)
// @route   DELETE /api/bookings/:id
// @access  Private (Sadece User)
const cancelBooking = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  const client = await pool.connect(); // Transaction için

  try {
    await client.query("BEGIN");

    // 1. Rezervasyonu getir ve kullanıcı kontrolü yap
    const bookingRes = await client.query(
      "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
      [id],
    );

    if (bookingRes.rows.length === 0) {
      throw new Error("Rezervasyon bulunamadı.");
    }

    const booking = bookingRes.rows[0];

    // 2. Yetki kontrolü (Sadece kendi rezervasyonunu iptal edebilir)
    if (booking.user_id !== user_id) {
      throw new Error("Bu rezervasyonu iptal etme yetkiniz yok.");
    }

    // 3. Zaten iptal/tamamlanmış mı kontrol et
    if (booking.status !== "active") {
      throw new Error(
        `Sadece aktif rezervasyonlar iptal edilebilir. Mevcut durum: ${booking.status}`,
      );
    }

    // 4. Kalan saati hesapla
    const bookingDateTime = new Date(booking.booking_date);
    const now = new Date();
    const hoursRemaining = (bookingDateTime - now) / (1000 * 60 * 60);

    let userRefund = 0;
    let ownerRefund = 0;
    const paidAmount = parseFloat(booking.paid_amount);

    // 5. İade miktarını hesapla
    if (hoursRemaining >= 12) {
      // 12 saat + kala: %100 iade
      userRefund = paidAmount;
      ownerRefund = 0;
    } else if (hoursRemaining > 0) {
      // 12 saatten az kala: %50 iade kullanıcıya, %50 salon sahibine
      userRefund = paidAmount * 0.5;
      ownerRefund = paidAmount * 0.5;
    } else {
      // Geçmiş rezervasyon
      throw new Error("Geçmiş bir rezervasyonu iptal edemezsiniz.");
    }

    // 6. Salon sahibinin wallet'ini getir (Eğer owner refund varsa)
    if (ownerRefund > 0) {
      const gymRes = await client.query(
        "SELECT owner_id FROM gyms WHERE id = $1",
        [booking.gym_id],
      );
      const owner_id = gymRes.rows[0].owner_id;

      // Owner'ın bakiyesini artır
      await client.query(
        "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
        [ownerRefund, owner_id],
      );
    }

    // 7. Kullanıcı bakiyesini artır
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
      [userRefund, user_id],
    );

    // 8. Salon kotasını geri artır
    await client.query(
      "UPDATE gym_config SET remaining_quota = remaining_quota + 1 WHERE gym_id = $1 AND target_date = $2",
      [booking.gym_id, booking.booking_date],
    );

    // 9. Rezervasyon durumunu "cancelled" olarak güncelle
    const cancelledBooking = await client.query(
      "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
      ["cancelled", id],
    );

    // 10. Cüzdan hareketlerine log ekle
    await client.query(
      "INSERT INTO wallet_transactions (user_id, booking_id, amount, type) VALUES ($1, $2, $3, $4)",
      [user_id, id, userRefund, "refund"],
    );

    if (ownerRefund > 0) {
      const gymRes = await client.query(
        "SELECT owner_id FROM gyms WHERE id = $1",
        [booking.gym_id],
      );
      const owner_id = gymRes.rows[0].owner_id;

      await client.query(
        "INSERT INTO wallet_transactions (user_id, booking_id, amount, type) VALUES ($1, $2, $3, $4)",
        [owner_id, id, ownerRefund, "cancellation_fee"],
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Rezervasyon iptal edildi. Kullanıcıya ₺${userRefund.toFixed(2)} iade edildi.${
        ownerRefund > 0
          ? ` Salon sahibine ₺${ownerRefund.toFixed(2)} aktarıldı.`
          : ""
      }`,
      data: {
        booking: cancelledBooking.rows[0],
        userRefund,
        ownerRefund,
        hoursRemaining: Math.round(hoursRemaining * 100) / 100,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Cancellation Error:", error.message);
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
};

module.exports = { getBookings, createBooking, checkInBooking, cancelBooking };
