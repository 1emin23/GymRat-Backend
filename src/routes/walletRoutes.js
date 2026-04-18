const express = require("express");
const router = express.Router();
const {
  getWalletSummary,
  depositMoney,
} = require("../controllers/walletController");
const { protect } = require("../middlewares/authMiddleware");

router.get("/summary", protect, getWalletSummary);
router.post("/deposit", protect, depositMoney);

module.exports = router;
