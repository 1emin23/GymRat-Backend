const express = require("express");
const router = express.Router();
const {
  getSlotsByGymAndDate,
  createOrUpdateSlots,
  getSlotsByGym,
  toggleSlotActive,
} = require("../controllers/slotController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * Public Routes
 */

// Get available slots for a gym on a specific date
// GET /api/slots/:gymId/:date (e.g., /api/slots/1/2024-05-15)
router.get("/:gymId/:date", getSlotsByGymAndDate);

/**
 * Owner/Private Routes
 */

// Get all slots for a gym (owner panel)
// GET /api/slots/:gymId
router.get("/:gymId", protect, authorize("owner"), getSlotsByGym);

// Create or update slots for a gym
// POST /api/slots/:gymId
// Body: { slots: [{ slot_number, slot_name, start_time, end_time, max_capacity }] }
router.post("/:gymId", protect, authorize("owner"), createOrUpdateSlots);

// Toggle slot active/inactive status
// PATCH /api/slots/:slotId/toggle
router.patch("/:slotId/toggle", protect, authorize("owner"), toggleSlotActive);

module.exports = router;
