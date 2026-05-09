const express = require("express");
const router = express.Router();
const {
  getBookings,
  checkInBooking,
  getBookingById,
} = require("../controllers/bookingController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createSlotBooking,
  cancelSlotBooking,
} = require("../controllers/bookingController.SLOT_UPDATED");

router.get("/", protect, getBookings);
router.post("/", protect, createSlotBooking);
router.delete("/:id", protect, cancelSlotBooking);
router.get("/:id", protect, getBookingById);

module.exports = router;
