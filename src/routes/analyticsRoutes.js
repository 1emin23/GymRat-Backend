const express = require("express");
const router = express.Router();
const { getOwnerSummary } = require("../controllers/analyticsController");
const { protect, authorize } = require("../middlewares/authMiddleware");

// Sadece 'owner' olanlar bu özetleri görebilir
router.get("/owner-summary", protect, authorize("owner"), getOwnerSummary);

module.exports = router;
