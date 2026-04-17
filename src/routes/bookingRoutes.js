const express = require("express");
const router = express.Router();
const { createBooking } = require("../controllers/bookingController");
const { protect } = require("../middlewares/authMiddleware");

router.post("/", protect, createBooking);

module.exports = router;
