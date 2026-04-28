const express = require("express");
const router = express.Router();
const {
  register,
  login,
  verifyEmail,
  verifyPhone,
  sendPhoneCode,
  resendEmailCode,
  changePassword,
} = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");

// Public routes
router.post("/register", register);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post("/verify-phone", verifyPhone);
router.post("/send-phone-code", sendPhoneCode);
router.post("/resend-email-code", resendEmailCode);
router.post("/change-password", protect, changePassword);

module.exports = router;
