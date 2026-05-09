/**
 * UPDATED BOOKING CONTROLLER - SLOT-BASED RESERVATIONS
 *
 * This file shows the MODIFIED createBooking function to support slot-based reservations.
 * Replace the existing createBooking function in bookingController.js with this version.
 *
 * Key changes:
 * - Accept slot_id instead of booking_date
 * - Validate slot availability and capacity
 * - Update slot_reservations table
 * - Store slot_start_time and slot_end_time in bookings
 */

const pool = require("../config/db");
const {
  hoursUntil,
  isSameDay,
  today,
  toISODate,
} = require("../utils/dateHelper");
const { validateSlotBooking } = require("../utils/slotHelper");

/**
 * @desc    Create a new slot-based reservation
 * @route   POST /api/bookings
 * @access  Private (User only)
 * @body    { gym_id, slot_id, booking_date (YYYY-MM-DD) }
 */
const createSlotBooking = async (req, res) => {
  const { gym_id, slot_id, booking_date } = req.body;
  const user_id = req.user.id;

  // Validate inputs
  if (!gym_id || !slot_id || !booking_date) {
    return res.status(400).json({
      success: false,
      message: "gym_id, slot_id, and booking_date are required.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Fetch slot details
    const slotResult = await client.query(
      `SELECT id, gym_id, slot_number, slot_name, start_time, end_time, 
              max_capacity, is_active
       FROM slots
       WHERE id = $1 FOR UPDATE`,
      [slot_id],
    );

    if (slotResult.rows.length === 0) {
      throw new Error("Slot not found.");
    }

    const slot = slotResult.rows[0];

    // 2. Verify slot belongs to the requested gym
    if (slot.gym_id !== gym_id) {
      throw new Error("Slot does not belong to this gym.");
    }

    // 3. Fetch or create slot_reservations record for this date
    const reservationResult = await client.query(
      `SELECT id, current_count, max_capacity
       FROM slot_reservations
       WHERE slot_id = $1 AND reservation_date = $2
       FOR UPDATE`,
      [slot_id, booking_date],
    );

    let reservation;
    if (reservationResult.rows.length === 0) {
      // Create new reservation record
      const createResult = await client.query(
        `INSERT INTO slot_reservations (slot_id, reservation_date, current_count, max_capacity)
         VALUES ($1, $2, 0, $3)
         RETURNING *`,
        [slot_id, booking_date, slot.max_capacity],
      );
      reservation = createResult.rows[0];
    } else {
      reservation = reservationResult.rows[0];
    }

    // 4. Validate slot availability
    const validation = validateSlotBooking(
      slot,
      booking_date,
      reservation.current_count,
      reservation.max_capacity,
    );

    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    // 5. Fetch gym pricing
    const gymResult = await client.query(
      "SELECT membership_price FROM gyms WHERE id = $1",
      [gym_id],
    );

    if (gymResult.rows.length === 0) {
      throw new Error("Gym not found.");
    }

    const price = parseFloat(gymResult.rows[0].membership_price);

    // 6. Check user wallet balance
    const userResult = await client.query(
      "SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE",
      [user_id],
    );

    const userBalance = parseFloat(userResult.rows[0].wallet_balance);

    if (userBalance < price) {
      throw new Error(
        `Insufficient balance. Required: ₺${price.toFixed(2)}, Available: ₺${userBalance.toFixed(2)}`,
      );
    }

    // 7. Deduct from wallet
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2",
      [price, user_id],
    );

    // 8. Increment slot reservation count
    await client.query(
      "UPDATE slot_reservations SET current_count = current_count + 1 WHERE id = $1",
      [reservation.id],
    );

    // 9. Create booking record
    const bookingResult = await client.query(
      `INSERT INTO bookings (
        user_id, gym_id, booking_date, booking_date_only, 
        slot_id, slot_start_time, slot_end_time, 
        paid_amount, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        user_id,
        gym_id,
        `${booking_date} ${slot.start_time}`, // Full datetime
        booking_date, // Just the date
        slot_id,
        slot.start_time,
        slot.end_time,
        price,
        "active",
      ],
    );

    // 10. Log wallet transaction
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
      slot_info: {
        slot_name: slot.slot_name,
        time_range: `${slot.start_time} - ${slot.end_time}`,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Slot Booking Error:", error.message);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * @desc    Cancel a slot-based booking
 * @route   DELETE /api/bookings/:id
 * @access  Private (User only)
 *
 * Updated to handle slot_reservations table
 */
const cancelSlotBooking = async (req, res) => {
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

    // 4. Calculate refund (same logic as before)
    const hoursRemaining = hoursUntil(booking.booking_date);
    let userRefund = 0;
    let ownerRefund = 0;
    const paidAmount = parseFloat(booking.paid_amount);

    if (hoursRemaining >= 12) {
      userRefund = paidAmount;
      ownerRefund = 0;
    } else if (hoursRemaining > 0) {
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
    if (ownerRefund > 0) {
      const gymResult = await client.query(
        "SELECT owner_id FROM gyms WHERE id = $1",
        [booking.gym_id],
      );
      const owner_id = gymResult.rows[0].owner_id;

      await client.query(
        "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
        [ownerRefund, owner_id],
      );
    }

    // 7. Decrement slot reservation count
    if (booking.slot_id) {
      await client.query(
        `UPDATE slot_reservations 
         SET current_count = GREATEST(current_count - 1, 0)
         WHERE slot_id = $1 AND reservation_date = $2`,
        [booking.slot_id, booking.booking_date_only],
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

    if (ownerRefund > 0) {
      const gymResult = await client.query(
        "SELECT owner_id FROM gyms WHERE id = $1",
        [booking.gym_id],
      );
      const owner_id = gymResult.rows[0].owner_id;

      await client.query(
        `INSERT INTO wallet_transactions (user_id, booking_id, amount, type)
         VALUES ($1, $2, $3, $4)`,
        [owner_id, id, ownerRefund, "cancellation_fee"],
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
    res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    client.release();
  }
};

module.exports = {
  createSlotBooking,
  cancelSlotBooking,
};
