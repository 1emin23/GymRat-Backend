const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const passport = require("../config/passport");

const {
  register,
  login,
  changePassword,
} = require("../controllers/authController");
const { sendOtp, verifyOtp } = require("../controllers/otpController");
const { protect } = require("../middlewares/authMiddleware");

// Public routes
router.post("/register", register);
router.post("/login", login);
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/change-password", protect, changePassword);

// 1) Başlat: frontend buraya yönlendirir
//    /api/auth/google?role=user&redirect=http://localhost:5173/auth/callback
router.get("/google", (req, res, next) => {
  const role = req.query.role === "owner" ? "owner" : "user";
  const redirect =
    req.query.redirect || `${process.env.FRONTEND_URL}/auth/callback`;
  const state = Buffer.from(JSON.stringify({ role, redirect })).toString(
    "base64",
  );

  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    state,
  })(req, res, next);
});

// 2) Callback: Google geri buraya döner
router.get("/google/callback", (req, res, next) => {
  passport.authenticate("google", { session: false }, (err, user) => {
    // state'ten frontend redirect'i çöz
    let redirect = `${process.env.FRONTEND_URL}/auth/callback`;
    try {
      const s = JSON.parse(
        Buffer.from(req.query.state || "", "base64").toString("utf8"),
      );
      if (s?.redirect) redirect = s.redirect;
    } catch {}

    if (err || !user) {
      const msg = encodeURIComponent(err?.message || "Google login failed");
      return res.redirect(`${redirect}?error=${msg}`);
    }

    // JWT üret — /login akışınla aynı payload'ı kullan
    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res.redirect(`${redirect}?token=${token}`);
  })(req, res, next);
});

module.exports = router;
