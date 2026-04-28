const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Verification code generator (6 digit)
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Mock email sender (şimdilik console'da göster)
const sendVerificationEmail = async (email, code, type = "email") => {
  try {
    // TODO: Gerçek email servisi (Nodemailer, SendGrid vb)
    console.log(`\n📧 [EMAIL] ${type.toUpperCase()} VERIFICATION`);
    console.log(`   To: ${email}`);
    console.log(`   Code: ${code}`);
    console.log(`   Expires in: 15 minutes\n`);
    return true;
  } catch (error) {
    console.error("Email gönderim hatası:", error);
    return false;
  }
};

// Şifre değiştirme fonksiyonu
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id; // protect middleware'inden gelen kullanıcı id'si

  try {
    // 1. Kullanıcıyı database'den bul (Tablo adının 'users' olduğunu varsayıyorum)
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    // 2. Mevcut şifreyi kontrol et
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Mevcut şifreniz hatalı." });
    }

    // 3. Yeni şifreyi hashle
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // 4. Veritabanında güncelle
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    res.status(200).json({ message: "Şifre başarıyla güncellendi." });
  } catch (error) {
    console.error("Change Password Error:", error);
    res.status(500).json({ message: "Sunucu hatası oluştu." });
  }
};

// Mock SMS sender (şimdilik console'da göster)
const sendVerificationSMS = async (phone, code) => {
  try {
    // TODO: Gerçek SMS servisi (Twilio, AWS SNS vb)
    console.log(`\n📱 [SMS] PHONE VERIFICATION`);
    console.log(`   Phone: ${phone}`);
    console.log(`   Code: ${code}`);
    console.log(`   Expires in: 15 minutes\n`);
    return true;
  } catch (error) {
    console.error("SMS gönderim hatası:", error);
    return false;
  }
};

// ==================== REGISTER ====================
const register = async (req, res) => {
  console.log("Register başladı");
  const { full_name, email, password, role, birth_date, phone } = req.body;

  try {
    // 1. Email zaten kullanılıyor mu kontrol et
    const userExists = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: "Bu email zaten kullanımda." });
    }

    // 2. Telefon validasyonu (owner için)
    if (role === "owner" && !phone) {
      return res
        .status(400)
        .json({ message: "Salon sahibi için telefon numarası gerekli." });
    }

    // 3. Şifreyi hashle
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 4. Email verification kodu oluştur
    const emailCode = generateVerificationCode();

    // 5. Veritabanına kaydet (email_verified = false)
    const newUser = await pool.query(
      `INSERT INTO users 
       (full_name, email, password_hash, role, birth_date, phone, email_verification_token) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, full_name, email, role, phone`,
      [
        full_name,
        email,
        password_hash,
        role || "user",
        birth_date,
        phone,
        emailCode,
      ],
    );

    // 6. Email verification kodu gönder
    await sendVerificationEmail(email, emailCode, "email");

    // 7. Response dön
    res.status(201).json({
      success: true,
      message: "Kayıt başarılı. Email doğrulaması gerekli.",
      verification_required: true,
      verification_type: "email",
      user_id: newUser.rows[0].id,
      email: newUser.rows[0].email,
      role: newUser.rows[0].role,
    });
  } catch (error) {
    console.error("Register Hatası:", error);
    res.status(500).json({ message: "Sunucu hatası." });
  }
};

// ==================== EMAIL VERIFICATION ====================
const verifyEmail = async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res
      .status(400)
      .json({ message: "Email ve doğrulama kodu gerekli." });
  }

  try {
    const user = await pool.query(
      `SELECT id, email, role, email_verification_token, email_verified 
       FROM users 
       WHERE email = $1`,
      [email],
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const userData = user.rows[0];

    // Email zaten doğrulanmış mı?
    if (userData.email_verified) {
      return res.status(400).json({ message: "Email zaten doğrulanmış." });
    }

    // Kod eşleşiyor mu?
    if (userData.email_verification_token !== code) {
      return res.status(400).json({ message: "Yanlış doğrulama kodu." });
    }

    // Email doğrulaması tamamla
    await pool.query(
      `UPDATE users 
       SET email_verified = TRUE, 
           email_verified_at = NOW(),
           email_verification_token = NULL
       WHERE id = $1`,
      [userData.id],
    );

    console.log(`✅ Email verified for user ${userData.id} (${email})`);

    // Owner için phone verification gerekli mi?
    if (userData.role === "owner") {
      return res.json({
        success: true,
        message: "Email doğrulandı. Telefon doğrulamasına geçin.",
        verification_required: true,
        next_step: "phone",
        user_id: userData.id,
      });
    }

    // Regular user için login işlemi yapabilir
    const token = jwt.sign(
      { id: userData.id, role: userData.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.json({
      success: true,
      message: "Email başarıyla doğrulandı.",
      token,
      user: { id: userData.id, email: userData.email, role: userData.role },
    });
  } catch (error) {
    console.error("Email Verification Error:", error);
    res.status(500).json({ message: "Doğrulama işlemi başarısız." });
  }
};

// ==================== PHONE VERIFICATION (OWNER) ====================
const verifyPhone = async (req, res) => {
  const { user_id, phone, code } = req.body;

  if (!user_id || !phone || !code) {
    return res
      .status(400)
      .json({ message: "User ID, telefon ve doğrulama kodu gerekli." });
  }

  try {
    const user = await pool.query(
      `SELECT id, role, phone, phone_verified, phone_verification_token, email_verified
       FROM users 
       WHERE id = $1`,
      [user_id],
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const userData = user.rows[0];

    // Owner mu?
    if (userData.role !== "owner") {
      return res
        .status(403)
        .json({ message: "Telefon doğrulaması sadece salon sahipleri için." });
    }

    // Email doğrulanmış mı?
    if (!userData.email_verified) {
      return res.status(400).json({
        message: "Email doğrulanmadığı için telefon doğrulayamazsınız.",
      });
    }

    // Telefon zaten doğrulanmış mı?
    if (userData.phone_verified) {
      return res.status(400).json({ message: "Telefon zaten doğrulanmış." });
    }

    // Kod eşleşiyor mu?
    if (userData.phone_verification_token !== code) {
      return res.status(400).json({ message: "Yanlış doğrulama kodu." });
    }

    // Telefon doğrulaması tamamla
    await pool.query(
      `UPDATE users 
       SET phone_verified = TRUE,
           phone_verified_at = NOW(),
           phone_verification_token = NULL,
           phone = $1
       WHERE id = $2`,
      [phone, user_id],
    );

    console.log(`✅ Phone verified for owner ${user_id} (${phone})`);

    // Token oluştur ve login yap
    const token = jwt.sign(
      { id: userData.id, role: userData.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.json({
      success: true,
      message: "Telefon başarıyla doğrulandı. Artık salon ekleyebilirsiniz!",
      token,
      user: { id: userData.id, role: userData.role, phone },
    });
  } catch (error) {
    console.error("Phone Verification Error:", error);
    res.status(500).json({ message: "Telefon doğrulaması başarısız." });
  }
};

// ==================== SEND PHONE VERIFICATION CODE ====================
const sendPhoneCode = async (req, res) => {
  const { user_id, phone } = req.body;

  if (!user_id || !phone) {
    return res
      .status(400)
      .json({ message: "User ID ve telefon numarası gerekli." });
  }

  try {
    const user = await pool.query("SELECT id, role FROM users WHERE id = $1", [
      user_id,
    ]);

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    if (user.rows[0].role !== "owner") {
      return res.status(403).json({
        message: "Sadece salon sahipleri telefon doğrulaması yapabilir.",
      });
    }

    // Yeni verification kodu oluştur ve gönder
    const phoneCode = generateVerificationCode();

    await pool.query(
      `UPDATE users 
       SET phone_verification_token = $1 
       WHERE id = $2`,
      [phoneCode, user_id],
    );

    // SMS gönder (şimdilik mock)
    await sendVerificationSMS(phone, phoneCode);

    res.json({
      success: true,
      message: "Doğrulama kodu SMS ile gönderildi.",
    });
  } catch (error) {
    console.error("Send Phone Code Error:", error);
    res.status(500).json({ message: "Kod gönderimi başarısız." });
  }
};

// ==================== RESEND EMAIL CODE ====================
const resendEmailCode = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email gerekli." });
  }

  try {
    const user = await pool.query(
      "SELECT id, email_verified FROM users WHERE email = $1",
      [email],
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    if (user.rows[0].email_verified) {
      return res.status(400).json({ message: "Email zaten doğrulanmış." });
    }

    // Yeni kod oluştur
    const emailCode = generateVerificationCode();

    await pool.query(
      `UPDATE users 
       SET email_verification_token = $1 
       WHERE email = $2`,
      [emailCode, email],
    );

    // Email gönder
    await sendVerificationEmail(email, emailCode, "email");

    res.json({
      success: true,
      message: "Doğrulama kodu email'e gönderildi.",
    });
  } catch (error) {
    console.error("Resend Email Code Error:", error);
    res.status(500).json({ message: "Kod gönderimi başarısız." });
  }
};

// ==================== LOGIN ====================
const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await pool.query(
      `SELECT id, full_name, email, password_hash, role, email_verified, phone_verified 
       FROM users WHERE email = $1`,
      [email],
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: "Kullanıcı bulunamadı." });
    }

    const user = userResult.rows[0];

    // Şifre eşleşiyor mu?
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Hatalı şifre." });
    }

    // Email doğrulanmadı mı?
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        message: "Email doğrulanmamış. Lütfen emailinizi doğrulayın.",
        verification_required: true,
        verification_type: "email",
        user_id: user.id,
        email: user.email,
      });
    }

    // Owner ise telefon da doğrulanmış mı?
    if (user.role === "owner" && !user.phone_verified) {
      return res.status(403).json({
        success: false,
        message: "Salon ekleyebilmek için telefon doğrulaması gerekli.",
        verification_required: true,
        verification_type: "phone",
        user_id: user.id,
      });
    }

    // Token oluştur
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, full_name: user.full_name, role: user.role },
    });
  } catch (error) {
    console.error("Login Hatası:", error);
    res.status(500).json({ message: "Sunucu hatası." });
  }
};

module.exports = {
  register,
  login,
  verifyEmail,
  verifyPhone,
  sendPhoneCode,
  resendEmailCode,
  changePassword,
};
