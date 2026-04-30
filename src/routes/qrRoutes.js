const express = require("express");
const router = express.Router();
const qrController = require("../controllers/qrController");
const { protect } = require("../middlewares/authMiddleware"); // Middleware adın farklıysa düzelt

// Lovable'ın beklediği: POST /api/bookings/:id/generate-qr
router.post("/:id/generate-qr", protect, qrController.generateQR);

// Lovable'ın beklediği: POST /api/bookings/check-in
router.post("/check-in", protect, qrController.checkIn);

module.exports = router;
