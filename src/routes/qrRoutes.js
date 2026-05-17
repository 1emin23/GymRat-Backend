const express = require("express");
const router = express.Router();
const qrController = require("../controllers/qrController");
const { protect, requireApprovedOwner } = require("../middlewares/authMiddleware");

// Üyenin bugünkü aktif rezervasyonu için sade QR üretimi
router.get("/qr", protect, qrController.generateQR);

// Belirli bir rezervasyon için QR üretimi
router.get("/:id/generate-qr", protect, qrController.generateQR);

// Lovable'ın beklediği: POST /api/bookings/check-in
router.post("/check-in", protect, requireApprovedOwner, qrController.checkIn);

module.exports = router;
