const express = require("express");
const router = express.Router();
const {
  getBookings,
  createBooking,
  cancelBooking,
  getBookingById,
} = require("../controllers/bookingController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router.get("/", protect, getBookings);
router.post("/", protect, createBooking);
router.delete("/:id", protect, cancelBooking);
router.get("/:id", protect, getBookingById);

module.exports = router;
