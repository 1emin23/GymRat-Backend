const express = require("express");
const router = express.Router();
const {
  register,
  login,
  verifyEmail,
  verifyPhone,
  sendPhoneCode,
  resendEmailCode,
} = require("../controllers/authController");

// Public routes
router.post("/register", register);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post("/verify-phone", verifyPhone);
router.post("/send-phone-code", sendPhoneCode);
router.post("/resend-email-code", resendEmailCode);

module.exports = router;
