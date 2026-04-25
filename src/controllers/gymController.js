const pool = require("../config/db");

// @desc    Yeni Spor Salonu Oluştur
// @route   POST /api/gyms
// @access  Private (Sadece Owner)
const createGym = async (req, res) => {
  const { name, location_lat, location_long, description, address } = req.body;
  const owner_id = req.user.id; // Token'dan gelen id

  try {
    const newGym = await pool.query(
      "INSERT INTO gyms (owner_id, name, location_lat, location_long, description, address) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [owner_id, name, location_lat, location_long, description, address],
    );

    res.status(201).json({
      success: true,
      message: "Spor salonu başarıyla oluşturuldu.",
      gym: newGym.rows[0],
    });
  } catch (error) {
    console.error("Gym Create Error:", error);
    res.status(500).json({ message: "Salon eklenirken bir hata oluştu." });
  }
};

// @desc    Tüm Salonları Listele (Herkes görebilir)
// @route   GET /api/gyms
const getAllGyms = async (req, res) => {
  try {
    const gyms = await pool.query(
      "SELECT g.*, AVG(r.rating) as avg_rating, COUNT(r.id) as review_count FROM gyms g LEFT JOIN reviews r ON g.id = r.gym_id GROUP BY g.id;",
    );
    res.json({ success: true, count: gyms.rows.length, data: gyms.rows });
  } catch (error) {
    res.status(500).json({ message: "Salonlar getirilemedi." });
  }
};

// @desc    Geliştirme Amaçlı: Test Verisi Oluştur
// @route   GET /api/gyms/seed/test-data
// @access  Public (Sadece geliştirme)
const seedTestData = async (req, res) => {
  try {
    // Test gym_config data oluştur
    const today = new Date().toISOString().split("T")[0];

    // Yarın ve sonraki 7 gün için config oluştur
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().split("T")[0]);
    }

    // Gym 1 için config oluştur
    for (const date of dates) {
      await pool.query(
        `INSERT INTO gym_config (gym_id, target_date, total_quota, remaining_quota, price, age_restriction, is_open)
         VALUES ($1, $2, $3, $3, $4, $5, $6)
         ON CONFLICT (gym_id, target_date) DO NOTHING`,
        [1, date, 50, 25, 0, true],
      );
    }

    res.json({
      success: true,
      message: "Test verisi başarıyla oluşturuldu",
      dates,
    });
  } catch (error) {
    console.error("Seed error:", error);
    res
      .status(500)
      .json({ message: "Test verisi oluşturulamadı", error: error.message });
  }
};

module.exports = { createGym, getAllGyms, seedTestData };
