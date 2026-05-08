const express = require("express");
const router = express.Router();
const {
  getWalletSummary,
  depositMoney,
  confirmStripeSession,
} = require("../controllers/walletController");
const { protect } = require("../middlewares/authMiddleware");

router.get("/summary", protect, getWalletSummary);
router.post("/deposit", protect, depositMoney);
router.post("/confirm-session", protect, confirmStripeSession);

module.exports = router;
