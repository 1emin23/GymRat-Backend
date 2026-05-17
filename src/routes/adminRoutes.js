const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  getKycSubmissions,
  getKycDetail,
  serveDocument,
  approveKyc,
  rejectKyc,
  getKycStats,
} = require("../controllers/adminController");

// ALL routes require admin role
router.use(protect, authorize("admin"));

// Stats
router.get("/kyc/stats", getKycStats);

// List submissions (optional ?status filter)
router.get("/kyc", getKycSubmissions);

// Single submission detail
router.get("/kyc/:userId", getKycDetail);

// Serve document securely (inline)
router.get("/kyc/:userId/documents/:type", serveDocument);

// Actions
router.patch("/kyc/:userId/approve", approveKyc);
router.patch("/kyc/:userId/reject", rejectKyc);

module.exports = router;
