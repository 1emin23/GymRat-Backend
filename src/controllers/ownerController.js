// backend/controllers/ownerController.js
const bcrypt = require("bcrypt");
const pool = require("../config/db.js"); // Senin gym_rat veritabanı bağlantın

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const ownerId = req.user.id; // Session veya JWT'den gelen owner ID

  try {
    // 1. Kullanıcıyı veritabanından bul
    const userResult = await pool.query(
      "SELECT password FROM owners WHERE id = $1",
      [ownerId],
    );
    const user = userResult.rows[0];

    // 2. Mevcut şifre doğru mu kontrol et (bcrypt ile)
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Mevcut şifreniz hatalı" });
    }

    // 3. Yeni şifreyi hashle (Güvenlik için şart!)
    const salt = await bcrypt.genSalt(10);
    const hashedPath = await bcrypt.hash(newPassword, salt);

    // 4. Veritabanında güncelle
    await pool.query("UPDATE owners SET password = $1 WHERE id = $2", [
      hashedPath,
      ownerId,
    ]);

    res.json({ message: "Şifre başarıyla güncellendi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Sunucu hatası" });
  }
};
