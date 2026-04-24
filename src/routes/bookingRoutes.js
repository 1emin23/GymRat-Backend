const express = require("express");
const router = express.Router();
const {
  getBookings,
  createBooking,
  checkInBooking,
  cancelBooking,
} = require("../controllers/bookingController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router.get("/", protect, getBookings);
router.post("/", protect, createBooking);
router.patch("/:id/checkin", protect, authorize("owner"), checkInBooking);
router.delete("/:id", protect, cancelBooking);

module.exports = router;
