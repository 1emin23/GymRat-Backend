const jwt = require("jsonwebtoken");

const protect = (req, res, next) => {
  let token;

  // Header'da "Authorization: Bearer <token>" var mı bakıyoruz
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // 1. Token'ı al ("Bearer " kısmını at)
      token = req.headers.authorization.split(" ")[1];

      // 2. Token'ı doğrula
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 3. Token içindeki kullanıcı bilgisini isteğe (req) ekle
      // Böylece sonraki fonksiyonlarda req.user.id ile kim olduğunu bileceğiz
      req.user = decoded;

      return next(); // Yoluna devam et
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Yetkisiz erişim, geçersiz token." });
    }
  }

  if (!token) {
    return res
      .status(401)
      .json({ message: "Token bulunamadı, giriş yapmalısın." });
  }
};

// Sadece salon sahiplerinin (owner) girebileceği yerler için ekstra koruma
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: `Bu işlem için '${req.user.role}' yetkiniz yok.` });
    }
    next();
  };
};

// Sadece e-posta doğrulanmış kullanıcılar için koruma
const requireVerified = async (req, res, next) => {
  try {
    const pool = require("../config/db");
    const result = await pool.query(
      "SELECT is_verified FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    if (!result.rows[0].is_verified) {
      return res
        .status(403)
        .json({ message: "E-posta adresinizi doğrulamanız gerekiyor." });
    }

    next();
  } catch (error) {
    console.error("requireVerified hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
};

const requireApprovedOwner = async (req, res, next) => {
  try {
    const pool = require("../config/db");
    const result = await pool.query(
      "SELECT approval_status FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    if (result.rows[0].approval_status !== "approved") {
      return res.status(403).json({
        message: "Bu işlem için işletme onayınızın tamamlanmış olması gerekir.",
      });
    }

    next();
  } catch (error) {
    console.error("requireApprovedOwner hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
};

module.exports = { protect, authorize, requireVerified, requireApprovedOwner };
