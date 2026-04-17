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
    const gyms = await pool.query("SELECT * FROM gyms");
    res.json({ success: true, count: gyms.rows.length, data: gyms.rows });
  } catch (error) {
    res.status(500).json({ message: "Salonlar getirilemedi." });
  }
};

module.exports = { createGym, getAllGyms };
