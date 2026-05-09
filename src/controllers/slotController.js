/**
 * Slot Controller
 *
 * Handles all slot-related operations:
 * - Fetching available slots for a gym on a specific date
 * - Creating/updating slot configurations
 * - Managing slot capacity and reservations
 */

const pool = require("../config/db");
const {
  getAvailableSlotsForDate,
  validateSlotBooking,
  toISODate,
} = require("../utils/slotHelper");

/**
 * @desc    Get available slots for a gym on a specific date
 * @route   GET /api/slots/:gymId/:date
 * @access  Public
 * @param   gymId - Gym ID
 * @param   date - YYYY-MM-DD format
 * @returns Array of slots with capacity info
 */
const getSlotsByGymAndDate = async (req, res) => {
  const { gymId, date } = req.params;

  try {
    // Validate date format
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD.",
      });
    }

    // 1. Fetch all active slots for this gym
    const slotsResult = await pool.query(
      `SELECT id, gym_id, slot_number, slot_name, start_time, end_time, 
              max_capacity, is_active, created_at, updated_at
       FROM slots
       WHERE gym_id = $1 AND is_active = true
       ORDER BY slot_number ASC`,
      [gymId],
    );

    if (slotsResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No slots configured for this gym.",
      });
    }

    // 2. Fetch slot reservations for this date
    const reservationsResult = await pool.query(
      `SELECT id, slot_id, reservation_date, current_count, max_capacity
       FROM slot_reservations
       WHERE slot_id = ANY($1) AND reservation_date = $2`,
      [slotsResult.rows.map((s) => s.id), date],
    );

    // 3. Enrich slots with availability and capacity info
    const enrichedSlots = getAvailableSlotsForDate(
      slotsResult.rows,
      date,
      reservationsResult.rows,
    );

    res.json({
      success: true,
      gym_id: gymId,
      date,
      slots: enrichedSlots,
    });
  } catch (error) {
    console.error("Get Slots Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching slots.",
      error: error.message,
    });
  }
};

/**
 * @desc    Create or update slots for a gym (Owner only)
 * @route   POST /api/slots/:gymId
 * @access  Private (Owner)
 * @body    Array of slot configs: [{ slot_number, slot_name, start_time, end_time, max_capacity }]
 */
const createOrUpdateSlots = async (req, res) => {
  const { gymId } = req.params;
  const { slots } = req.body;
  const owner_id = req.user.id;

  try {
    // 1. Verify gym ownership
    const gymCheck = await pool.query(
      "SELECT id, owner_id FROM gyms WHERE id = $1",
      [gymId],
    );

    if (gymCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gym not found.",
      });
    }

    if (gymCheck.rows[0].owner_id !== owner_id) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to modify this gym's slots.",
      });
    }

    // 2. Validate slots array
    if (!Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Slots must be a non-empty array.",
      });
    }

    if (slots.length > 3) {
      return res.status(400).json({
        success: false,
        message: "Maximum 3 slots allowed per gym.",
      });
    }

    // 3. Validate each slot
    for (const slot of slots) {
      if (!slot.slot_number || ![1, 2, 3].includes(slot.slot_number)) {
        return res.status(400).json({
          success: false,
          message: "slot_number must be 1, 2, or 3.",
        });
      }

      if (!slot.start_time || !slot.end_time) {
        return res.status(400).json({
          success: false,
          message: "start_time and end_time are required.",
        });
      }

      if (slot.start_time >= slot.end_time) {
        return res.status(400).json({
          success: false,
          message: "start_time must be before end_time.",
        });
      }

      if (!slot.max_capacity || slot.max_capacity <= 0) {
        return res.status(400).json({
          success: false,
          message: "max_capacity must be a positive number.",
        });
      }
    }

    // 4. Use transaction to update slots
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Delete existing slots for this gym
      await client.query("DELETE FROM slots WHERE gym_id = $1", [gymId]);

      // Insert new slots
      const createdSlots = [];
      for (const slot of slots) {
        const result = await client.query(
          `INSERT INTO slots (gym_id, slot_number, slot_name, start_time, end_time, max_capacity, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING *`,
          [
            gymId,
            slot.slot_number,
            slot.slot_name || null,
            slot.start_time,
            slot.end_time,
            slot.max_capacity,
          ],
        );
        createdSlots.push(result.rows[0]);
      }

      // Ensure gym_slot_config exists
      await client.query(
        `INSERT INTO gym_slot_config (gym_id, slots_enabled, default_max_capacity)
         VALUES ($1, true, $2)
         ON CONFLICT (gym_id) DO UPDATE SET slots_enabled = true`,
        [gymId, slots[0].max_capacity || 20],
      );

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: "Slots created/updated successfully.",
        slots: createdSlots,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create/Update Slots Error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating/updating slots.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all slots for a gym (for admin/owner panel)
 * @route   GET /api/slots/:gymId
 * @access  Private (Owner)
 */
const getSlotsByGym = async (req, res) => {
  const { gymId } = req.params;
  const owner_id = req.user.id;

  try {
    // Verify ownership
    const gymCheck = await pool.query(
      "SELECT id, owner_id FROM gyms WHERE id = $1",
      [gymId],
    );

    if (gymCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gym not found.",
      });
    }

    if (gymCheck.rows[0].owner_id !== owner_id) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view this gym's slots.",
      });
    }

    // Fetch slots
    const result = await pool.query(
      `SELECT id, gym_id, slot_number, slot_name, start_time, end_time, 
              max_capacity, is_active, created_at, updated_at
       FROM slots
       WHERE gym_id = $1
       ORDER BY slot_number ASC`,
      [gymId],
    );

    res.json({
      success: true,
      gym_id: gymId,
      slots: result.rows,
    });
  } catch (error) {
    console.error("Get Slots Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching slots.",
      error: error.message,
    });
  }
};

/**
 * @desc    Toggle slot active status (Owner only)
 * @route   PATCH /api/slots/:slotId/toggle
 * @access  Private (Owner)
 */
const toggleSlotActive = async (req, res) => {
  const { slotId } = req.params;
  const owner_id = req.user.id;

  try {
    // Verify ownership
    const slotCheck = await pool.query(
      `SELECT s.id, s.gym_id, s.is_active, g.owner_id
       FROM slots s
       JOIN gyms g ON s.gym_id = g.id
       WHERE s.id = $1`,
      [slotId],
    );

    if (slotCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Slot not found.",
      });
    }

    if (slotCheck.rows[0].owner_id !== owner_id) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to modify this slot.",
      });
    }

    // Toggle active status
    const newStatus = !slotCheck.rows[0].is_active;
    const result = await pool.query(
      "UPDATE slots SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
      [newStatus, slotId],
    );

    res.json({
      success: true,
      message: `Slot ${newStatus ? "activated" : "deactivated"}.`,
      slot: result.rows[0],
    });
  } catch (error) {
    console.error("Toggle Slot Error:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling slot.",
      error: error.message,
    });
  }
};

module.exports = {
  getSlotsByGymAndDate,
  createOrUpdateSlots,
  getSlotsByGym,
  toggleSlotActive,
};
