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

      next(); // Yoluna devam et
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

module.exports = { protect, authorize };
