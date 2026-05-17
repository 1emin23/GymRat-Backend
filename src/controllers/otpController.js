const pool = require("../config/db");
const { sendOtpEmail } = require("../services/emailService");

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ==================== SEND OTP ====================
const sendOtp = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "E-posta adresi gereklidir." });
  }

  try {
    const userResult = await pool.query(
      "SELECT id, is_verified FROM users WHERE email = $1",
      [email.toLowerCase()],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const user = userResult.rows[0];

    if (user.is_verified) {
      return res
        .status(400)
        .json({ message: "Bu e-posta adresi zaten doğrulanmış." });
    }

    const otpCode = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 dakika
    console.log("otpExpiresAt in otpController", otpExpiresAt);

    await pool.query(
      "UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3",
      [otpCode, otpExpiresAt, user.id],
    );

    await sendOtpEmail(email, otpCode);

    return res.json({
      success: true,
      message: "Doğrulama kodu e-posta adresinize gönderildi.",
    });
  } catch (error) {
    console.error("Send OTP Hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
};

// ==================== VERIFY OTP ====================
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "E-posta ve kod gereklidir." });
  }

  try {
    const userResult = await pool.query(
      "SELECT id, otp_code, otp_expires_at, is_verified FROM users WHERE email = $1",
      [email.toLowerCase()],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const user = userResult.rows[0];

    if (user.is_verified) {
      return res.status(400).json({ message: "Bu hesap zaten doğrulanmış." });
    }

    if (user.otp_code !== otp) {
      return res.status(400).json({ message: "Geçersiz doğrulama kodu." });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res
        .status(400)
        .json({ message: "Doğrulama kodunun süresi dolmuş." });
    }

    // Doğrula
    await pool.query(
      "UPDATE users SET is_verified = TRUE, otp_code = NULL, otp_expires_at = NULL WHERE id = $1",
      [user.id],
    );

    return res.json({
      success: true,
      message: "E-posta adresiniz başarıyla doğrulandı.",
    });
  } catch (error) {
    console.error("Verify OTP Hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
};

module.exports = { sendOtp, verifyOtp };
