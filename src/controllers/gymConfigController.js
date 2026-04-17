const pool = require("../config/db");

// @desc    Spor salonu için günlük kota ve fiyat ayarlarını yap/güncelle
// @route   POST /api/gyms/:gymId/config
// @access  Private (Sadece Salon Sahibi)
const setGymConfig = async (req, res) => {
  const { gymId } = req.params;
  const { target_date, total_quota, price, age_restriction, is_open } =
    req.body;
  const owner_id = req.user.id;

  try {
    // 1. Yetki Kontrolü: Bu salon gerçekten bu kullanıcıya mı ait?
    const gymCheck = await pool.query(
      "SELECT * FROM gyms WHERE id = $1 AND owner_id = $2",
      [gymId, owner_id],
    );

    if (gymCheck.rows.length === 0) {
      return res
        .status(403)
        .json({ message: "Bu salon üzerinde işlem yapma yetkiniz yok." });
    }

    // 2. Config Oluşturma veya Güncelleme (ON CONFLICT)
    // remaining_quota ilk oluşturulurken total_quota'ya eşitlenir.
    const config = await pool.query(
      `INSERT INTO gym_config (gym_id, target_date, total_quota, remaining_quota, price, age_restriction, is_open)
             VALUES ($1, $2, $3, $3, $4, $5, $6)
             ON CONFLICT (gym_id, target_date)
             DO UPDATE SET 
                total_quota = EXCLUDED.total_quota,
                price = EXCLUDED.price,
                age_restriction = EXCLUDED.age_restriction,
                is_open = EXCLUDED.is_open,
                remaining_quota = CASE 
                    WHEN gym_config.total_quota != EXCLUDED.total_quota 
                    THEN EXCLUDED.total_quota -- Kota değişirse sıfırla (Basit mantık)
                    ELSE gym_config.remaining_quota 
                END
             RETURNING *`,
      [
        gymId,
        target_date,
        total_quota,
        price,
        age_restriction || 0,
        is_open !== undefined ? is_open : true,
      ],
    );

    res.status(200).json({
      success: true,
      message: "Günlük ayarlar kaydedildi.",
      data: config.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Konfigürasyon hatası." });
  }
};

module.exports = { setGymConfig };
