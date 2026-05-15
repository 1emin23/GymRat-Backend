const pool = require("../config/db");
const {
  hoursUntil,
  toISODate,
  now,
  parseDate,
  today,
} = require("../utils/dateHelper");

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
        `SELECT b.id, b.user_id, b.gym_id, b.booking_date, b.paid_amount,
                CASE 
                  WHEN b.status = 'active' 
                    AND gc.end_time IS NOT NULL
                    AND (b.booking_date::date + gc.end_time::time) < CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul'
                  THEN 'no_show'
                  ELSE b.status
                END as status,
                b.created_at, g.name as gym_name, u.full_name, u.email,
                gc.start_time, gc.end_time
         FROM bookings b
         JOIN gyms g ON b.gym_id = g.id
         JOIN users u ON b.user_id = u.id
         LEFT JOIN gym_config gc ON gc.gym_id = b.gym_id
           AND gc.target_date = b.booking_date
           AND gc.slot_index = (
             SELECT MIN(gc2.slot_index) FROM gym_config gc2
             WHERE gc2.gym_id = b.gym_id AND gc2.target_date = b.booking_date
           )
         WHERE g.owner_id = $1
         ORDER BY b.booking_date DESC`,
        [user_id],
      );
    } else {
      bookings = await pool.query(
        `SELECT b.id, b.user_id, b.gym_id, b.booking_date, b.paid_amount,
                CASE 
                  WHEN b.status = 'active' 
                    AND gc.end_time IS NOT NULL
                    AND (b.booking_date::date + gc.end_time::time) < CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul'
                  THEN 'no_show'
                  ELSE b.status
                END as status,
                b.created_at, g.name as gym_name,
                gc.start_time, gc.end_time
         FROM bookings b
         JOIN gyms g ON b.gym_id = g.id
         LEFT JOIN gym_config gc ON gc.gym_id = b.gym_id
           AND gc.target_date = b.booking_date
           AND gc.slot_index = (
             SELECT MIN(gc2.slot_index) FROM gym_config gc2
             WHERE gc2.gym_id = b.gym_id AND gc2.target_date = b.booking_date
           )
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
/**
 * @desc    Create a new daily reservation
 * @route   POST /api/bookings
 * @access  Private (User only)
 * @body    { gym_id, booking_date (YYYY-MM-DD) }
 */
const createBooking = async (req, res) => {
  const { gym_id, booking_date, slot_index } = req.body;
  const user_id = req.user.id;

  if (!gym_id || !booking_date) {
    return res.status(400).json({
      success: false,
      message: "gym_id and booking_date are required.",
    });
  }

  const isoDate = toISODate(booking_date);
  if (!isoDate) {
    return res.status(400).json({
      success: false,
      message: "Invalid booking_date format.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Fetch daily config for the target date (and slot if specified)
    let configQuery;
    let configParams;
    if (slot_index != null) {
      configQuery = `SELECT id, slot_index, total_quota, remaining_quota, price, is_open
                     FROM gym_config
                     WHERE gym_id = $1 AND target_date = $2 AND slot_index = $3
                     FOR UPDATE`;
      configParams = [gym_id, isoDate, slot_index];
    } else {
      configQuery = `SELECT id, slot_index, total_quota, remaining_quota, price, is_open
                      FROM gym_config
                      WHERE gym_id = $1 AND target_date = $2 AND is_open = TRUE
                      ORDER BY slot_index ASC LIMIT 1
                      FOR UPDATE`;
      configParams = [gym_id, isoDate];
    }

    const configResult = await client.query(configQuery, configParams);

    if (configResult.rows.length === 0) {
      // Debug: check if any config exists at all for this gym+date
      const debugResult = await client.query(
        `SELECT id, slot_index, is_open, remaining_quota, target_date FROM gym_config WHERE gym_id = $1 AND target_date = $2`,
        [gym_id, isoDate],
      );
      console.error("Booking config miss:", {
        gym_id,
        isoDate,
        slot_index,
        rowsFound: debugResult.rows.length,
        rows: debugResult.rows,
      });
      throw new Error("No daily configuration found for this date.");
    }

    const config = configResult.rows[0];

    // Geçmiş güne rezervasyon engeli
    const todayStr = today();
    if (isoDate < todayStr) {
      throw new Error("Geçmiş bir güne rezervasyon yapılamaz.");
    }

    // Bugün ise slot başlangıç saati geçmiş mi kontrol et
    if (isoDate === todayStr && config.start_time) {
      const slotStart = parseDate(`${isoDate}T${config.start_time}`);
      if (slotStart && slotStart.isBefore(now())) {
        throw new Error(
          "Bu slotun başlangıç saati geçmiş. Lütfen ileri bir zaman seçin.",
        );
      }
    }

    if (config.is_open === false) {
      throw new Error("This slot is closed for booking.");
    }

    const remaining = Number(config.remaining_quota ?? 0);
    const total = Number(config.total_quota ?? 0);
    if (total <= 0 || remaining <= 0) {
      throw new Error("Daily quota is full for this date.");
    }

    // 2. Check user wallet balance
    const userResult = await client.query(
      "SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE",
      [user_id],
    );
    const userBalance = parseFloat(userResult.rows[0].wallet_balance);
    const price = Number(config.price ?? 0);

    if (userBalance < price) {
      throw new Error(
        `Insufficient balance. Required: ₺${price.toFixed(2)}, Available: ₺${userBalance.toFixed(2)}`,
      );
    }

    // 3. Deduct from wallet
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2",
      [price, user_id],
    );

    // 4. Decrement remaining quota
    await client.query(
      "UPDATE gym_config SET remaining_quota = remaining_quota - 1 WHERE id = $1",
      [config.id],
    );

    // 5. Create booking record
    const bookingResult = await client.query(
      `INSERT INTO bookings (
        user_id, gym_id, booking_date, paid_amount, status, slot_index
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [user_id, gym_id, isoDate, price, "active", config.slot_index ?? null],
    );

    // 6. Log wallet transaction
    await client.query(
      `INSERT INTO wallet_transactions (user_id, booking_id, amount, type)
       VALUES ($1, $2, $3, $4)`,
      [user_id, bookingResult.rows[0].id, -price, "payment"],
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Booking created successfully.",
      data: bookingResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Booking Error:", error.message);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * @desc    Cancel a daily booking
 * @route   DELETE /api/bookings/:id
 * @access  Private (User only)
 *
 * Updated for daily quota reservations
 */
const cancelBooking = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Fetch booking
    const bookingResult = await client.query(
      "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
      [id],
    );

    if (bookingResult.rows.length === 0) {
      throw new Error("Booking not found.");
    }

    const booking = bookingResult.rows[0];

    // 2. Verify ownership
    if (booking.user_id !== user_id) {
      throw new Error("You do not have permission to cancel this booking.");
    }

    // 3. Check if already cancelled
    if (booking.status !== "active") {
      throw new Error(
        `Only active bookings can be cancelled. Current status: ${booking.status}`,
      );
    }

    // 4. Calculate refund
    const nowTr = now();
    const bookingDay = parseDate(booking.booking_date);
    const hoursRemaining = bookingDay
      ? bookingDay.diff(nowTr, "hour", true)
      : 0;
    let userRefund = 0;
    let ownerRefund = 0;
    const paidAmount = parseFloat(booking.paid_amount);

    if (hoursRemaining >= 12) {
      userRefund = paidAmount;
      ownerRefund = 0;
    } else if (hoursRemaining > -24) {
      userRefund = paidAmount * 0.5;
      ownerRefund = paidAmount * 0.5;
    } else {
      throw new Error("Cannot cancel past bookings.");
    }

    // 5. Refund to user
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
      [userRefund, user_id],
    );

    // 6. Refund to owner (if applicable)
    let owner_id = null;
    if (ownerRefund > 0) {
      const gymResult = await client.query(
        "SELECT owner_id FROM gyms WHERE id = $1",
        [booking.gym_id],
      );
      owner_id = gymResult.rows[0].owner_id;

      await client.query(
        "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
        [ownerRefund, owner_id],
      );
    }

    // 7. Restore daily quota
    // New bookings have gym_config_id — use it directly
    if (booking.gym_config_id) {
      await client.query(
        `UPDATE gym_config
         SET remaining_quota = LEAST(remaining_quota + 1, total_quota)
         WHERE id = $1`,
        [booking.gym_config_id],
      );
    } else if (booking.slot_index != null) {
      // Legacy bookings: match by gym_id + target_date + slot_index
      await client.query(
        `UPDATE gym_config
         SET remaining_quota = LEAST(remaining_quota + 1, total_quota)
         WHERE gym_id = $1 AND target_date = $2 AND slot_index = $3`,
        [booking.gym_id, booking.booking_date, booking.slot_index],
      );
    } else {
      // Very old bookings without slot_index
      await client.query(
        `UPDATE gym_config
         SET remaining_quota = LEAST(remaining_quota + 1, total_quota)
         WHERE gym_id = $1 AND target_date = $2`,
        [booking.gym_id, booking.booking_date],
      );
    }

    // 8. Update booking status
    const cancelledResult = await client.query(
      "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
      ["cancelled", id],
    );

    // 9. Log transactions
    await client.query(
      `INSERT INTO wallet_transactions (user_id, booking_id, amount, type)
       VALUES ($1, $2, $3, $4)`,
      [user_id, id, userRefund, "refund"],
    );

    if (ownerRefund > 0 && owner_id) {
      await client.query(
        `INSERT INTO wallet_transactions (user_id, booking_id, amount, type)
         VALUES ($1, $2, $3, $4)`,
        [owner_id, id, ownerRefund, "refund"],
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Booking cancelled. Refunded ₺${userRefund.toFixed(2)} to user.${
        ownerRefund > 0
          ? ` ₺${ownerRefund.toFixed(2)} transferred to owner.`
          : ""
      }`,
      data: {
        booking: cancelledResult.rows[0],
        userRefund,
        ownerRefund,
        hoursRemaining: Math.round(hoursRemaining * 100) / 100,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Cancellation Error:", error.message);
    console.error("Cancellation Stack:", error.stack);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    client.release();
  }
};

const getBookingById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  console.log(id, userId, "bookingController ");
  const { rows } = await pool.query(
    `SELECT b.*, g.name AS gym_name
     FROM bookings b
     LEFT JOIN gyms g ON g.id = b.gym_id
     WHERE b.id = $1 AND b.user_id = $2`,
    [id, userId],
  );
  if (!rows.length)
    return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: rows[0] });
};

module.exports = {
  getBookings,
  createBooking,
  cancelBooking,
  getBookingById,
};
