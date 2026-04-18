const express = require("express");
const router = express.Router();
const {
  createBooking,
  checkInBooking,
} = require("../controllers/bookingController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router.post("/", protect, createBooking);
router.patch("/:id/checkin", protect, authorize("owner"), checkInBooking);

module.exports = router;
