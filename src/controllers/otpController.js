const pool = require("../config/db");
const jwt = require("jsonwebtoken");
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
    // Hem email hem de pending_email'e göre ara (profil güncellemeleri için)
    const userResult = await pool.query(
      "SELECT id, is_verified, otp_sent_at, email, pending_email FROM users WHERE email = $1 OR pending_email = $1",
      [email.toLowerCase()],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const user = userResult.rows[0];

    // Eğer pending_email varsa ve bu e-posta zaten doğrulanmışsa
    if (user.pending_email && user.pending_email.toLowerCase() === email.toLowerCase()) {
      // Devam et, OTP gönder
    } else if (user.is_verified && !user.pending_email) {
      return res
        .status(400)
        .json({ message: "Bu e-posta adresi zaten doğrulanmış." });
    }

    // 30 saniye throttle kontrolü
    if (user.otp_sent_at) {
      const lastSent = new Date(user.otp_sent_at).getTime();
      const now = Date.now();
      const diffSeconds = (now - lastSent) / 1000;
      if (diffSeconds < 30) {
        const wait = Math.ceil(30 - diffSeconds);
        return res.status(429).json({
          message: `Lütfen ${wait} saniye sonra tekrar deneyin.`,
          retryAfter: wait,
        });
      }
    }

    const otpCode = generateOtp();
    console.log(`[TEST OTP] Email: ${email} | Kod: ${otpCode}`);
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 dakika

    await pool.query(
      "UPDATE users SET otp_code = $1, otp_expires_at = $2, otp_sent_at = NOW() WHERE id = $3",
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
    // Hem email hem de pending_email'e göre ara
    const userResult = await pool.query(
      "SELECT id, otp_code, otp_expires_at, is_verified, pending_email FROM users WHERE email = $1 OR pending_email = $1",
      [email.toLowerCase()],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const user = userResult.rows[0];

    if (user.is_verified && !user.pending_email) {
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

    // Eğer pending_email varsa, onu asıl email'e taşı
    const hasPendingEmail = user.pending_email && user.pending_email.toLowerCase() === email.toLowerCase();

    if (hasPendingEmail) {
      await pool.query(
        "UPDATE users SET email = $1, pending_email = NULL, is_verified = TRUE, otp_code = NULL, otp_expires_at = NULL WHERE id = $2",
        [email.toLowerCase(), user.id],
      );
    } else {
      await pool.query(
        "UPDATE users SET is_verified = TRUE, otp_code = NULL, otp_expires_at = NULL WHERE id = $1",
        [user.id],
      );
    }

    // Kullanıcı bilgisini çek
    const verifiedUserResult = await pool.query(
      "SELECT id, full_name, email, role, approval_status FROM users WHERE id = $1",
      [user.id],
    );
    const verifiedUser = verifiedUserResult.rows[0];

    // Token oluştur (sadece login/register flow'ları için, profil güncellemede token zaten var)
    const token = jwt.sign(
      { id: verifiedUser.id, role: verifiedUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res.json({
      success: true,
      message: "E-posta adresiniz başarıyla doğrulandı.",
      token,
      user: { id: verifiedUser.id, full_name: verifiedUser.full_name, role: verifiedUser.role, is_verified: true, approval_status: verifiedUser.approval_status },
    });
  } catch (error) {
    console.error("Verify OTP Hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
};

module.exports = { sendOtp, verifyOtp };
