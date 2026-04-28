const express = require("express");
const router = express.Router();
const { generateQR, verifyQR } = require("../controllers/qrController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router.post("/generate", protect, generateQR);
router.post("/verify", protect, authorize("owner"), verifyQR);

module.exports = router;
