const pool = require("../config/db");
const fs = require("fs");
const path = require("path");

// @desc    Yeni Spor Salonu Oluştur
// @route   POST /api/gyms
// @access  Private (Sadece Owner - Email + Phone Verified)
const createGym = async (req, res) => {
  const {
    name,
    location_lat,
    location_long,
    description,
    address,
    city,
    phone,
    email,
    opening_time,
    closing_time,
    membership_price,
    daily_price,
    daily_capacity,
    amenities,
  } = req.body;
  const owner_id = req.user.id;

  try {
    // 1. Owner'ın email ve telefon doğrulanmış mı kontrol et
    const ownerCheck = await pool.query(
      `SELECT id, role, email_verified, phone_verified 
       FROM users 
       WHERE id = $1`,
      [owner_id],
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const owner = ownerCheck.rows[0];

    if (owner.role !== "owner") {
      return res
        .status(403)
        .json({ message: "Sadece salon sahipleri salon ekleyebilir." });
    }

    if (!owner.email_verified) {
      return res.status(403).json({
        message: "Salon eklemek için email doğrulaması gerekli.",
      });
    }

    if (!owner.phone_verified) {
      return res.status(403).json({
        message: "Salon eklemek için telefon doğrulaması gerekli.",
      });
    }

    // 2. Validasyon
    if (!name || !address || !city || !membership_price) {
      return res.status(400).json({
        message: "Salon adı, adres, şehir ve fiyat zorunludur.",
      });
    }

    // 3. Default coordinates (İstanbul merkezi - 41.0082, 28.9784)
    const lat = location_lat || 41.0082;
    const long = location_long || 28.9784;

    // 4. Create gym in database first
    const newGym = await pool.query(
      `INSERT INTO gyms (owner_id, name, location_lat, location_long, description, address, city, phone, email, opening_time, closing_time, membership_price, daily_price, amenities) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
       RETURNING *`,
      [
        owner_id,
        name,
        lat,
        long,
        description || null,
        address,
        city,
        phone || null,
        email || null,
        opening_time || "06:00",
        closing_time || "23:00",
        membership_price,
        daily_price || null,
        amenities || null,
      ],
    );

    const gymId = newGym.rows[0].id;

    // 5. Create default gym_config for today and next 30 days if daily_price and daily_capacity provided
    if (daily_price && daily_capacity) {
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split("T")[0];

        try {
          await pool.query(
            `INSERT INTO gym_config (gym_id, target_date, total_quota, remaining_quota, price, is_open)
             VALUES ($1, $2, $3, $3, $4, true)
             ON CONFLICT (gym_id, target_date) DO NOTHING`,
            [gymId, dateStr, daily_capacity, daily_price],
          );
        } catch (err) {
          console.error(`Failed to create gym_config for ${dateStr}:`, err);
          // Continue even if one fails
        }
      }
    }

    // 6. Handle image files if uploaded
    if (req.files && req.files.length > 0) {
      const gymImageDir = path.join(
        __dirname,
        "../../public/gym_images",
        gymId.toString(),
      );

      // Create gym_id specific directory
      fs.mkdirSync(gymImageDir, { recursive: true });

      // Move uploaded files to gym-specific folder
      for (const file of req.files) {
        const oldPath = file.path;
        const newPath = path.join(gymImageDir, file.filename);

        try {
          fs.renameSync(oldPath, newPath);
        } catch (err) {
          console.error("File move error:", err);
          // Continue with other files even if one fails
        }
      }

      // Cleanup temp directory if empty
      const tempDirParent = path.dirname(req.files[0].path);
      try {
        fs.rmdirSync(tempDirParent);
      } catch (err) {
        // Directory might not be empty, that's okay
      }
    }

    res.status(201).json({
      success: true,
      message: "Spor salonu başarıyla oluşturuldu.",
      gym: newGym.rows[0],
    });
  } catch (error) {
    console.error("Gym Create Error:", error);

    // Cleanup uploaded files in case of error
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    }

    res.status(500).json({
      message: "Salon eklenirken bir hata oluştu.",
      error: error.message,
    });
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

const getGymById = async (req, res) => {
  const { gymId } = req.params;

  try {
    // Validate that gymId is a valid number
    if (!gymId || isNaN(parseInt(gymId))) {
      return res.status(400).json({
        success: false,
        message: "Geçersiz salon ID.",
      });
    }

    const gym = await pool.query(
      `SELECT g.*, AVG(r.rating) as avg_rating, COUNT(r.id) as review_count 
       FROM gyms g 
       LEFT JOIN reviews r ON g.id = r.gym_id 
       WHERE g.id = $1 
       GROUP BY g.id`,
      [gymId],
    );

    // Return 404 if gym not found
    if (!gym.rows || gym.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Salon bulunamadı.",
      });
    }

    res.json({
      success: true,
      gym: gym.rows[0],
    });
  } catch (error) {
    console.error("Get Gym By ID Error:", error);
    res.status(500).json({
      success: false,
      message: "Salon getirilemedi.",
      error: error.message,
    });
  }
};

// @desc    Owner'ın Salonlarını Getir
// @route   GET /api/gyms/owner/gyms
// @access  Private (Sadece Owner)
const getOwnerGyms = async (req, res) => {
  const owner_id = req.user.id;

  try {
    const gyms = await pool.query(
      "SELECT * FROM gyms WHERE owner_id = $1 ORDER BY created_at DESC",
      [owner_id],
    );

    res.json({
      success: true,
      count: gyms.rows.length,
      items: gyms.rows,
    });
  } catch (error) {
    console.error("Get Owner Gyms Error:", error);
    res.status(500).json({ message: "Salonlar getirilemedi." });
  }
};

// @desc    Salonu Güncelle
// @route   PATCH /api/gyms/:gymId
// @access  Private (Sadece Owner)
const updateGym = async (req, res) => {
  const { gymId } = req.params;
  const owner_id = req.user.id;
  const {
    name,
    description,
    address,
    city,
    phone,
    email,
    opening_time,
    closing_time,
    membership_price,
    amenities,
  } = req.body;

  try {
    // Check if gym belongs to owner
    const gymCheck = await pool.query(
      "SELECT * FROM gyms WHERE id = $1 AND owner_id = $2",
      [gymId, owner_id],
    );

    if (gymCheck.rows.length === 0) {
      return res.status(403).json({ message: "Bu salonu güncelleyemezsiniz." });
    }

    const existingGym = gymCheck.rows[0];

    const updatedGym = await pool.query(
      `UPDATE gyms SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        address = COALESCE($3, address),
        city = COALESCE($4, city),
        phone = COALESCE($5, phone),
        email = COALESCE($6, email),
        opening_time = COALESCE($7, opening_time),
        closing_time = COALESCE($8, closing_time),
        membership_price = COALESCE($9, membership_price),
        amenities = COALESCE($10, amenities),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11 AND owner_id = $12
      RETURNING *`,
      [
        name,
        description,
        address,
        city,
        phone,
        email,
        opening_time,
        closing_time,
        membership_price,
        amenities,
        gymId,
        owner_id,
      ],
    );

    // Handle new image files if uploaded
    if (req.files && req.files.length > 0) {
      const gymImageDir = path.join(
        __dirname,
        "../../public/gym_images",
        gymId.toString(),
      );

      // Create gym_id specific directory if it doesn't exist
      fs.mkdirSync(gymImageDir, { recursive: true });

      // Move uploaded files to gym-specific folder
      for (const file of req.files) {
        const oldPath = file.path;
        const newPath = path.join(gymImageDir, file.filename);

        try {
          fs.renameSync(oldPath, newPath);
        } catch (err) {
          console.error("File move error:", err);
          // Continue with other files even if one fails
        }
      }

      // Cleanup temp directory if empty
      const tempDirParent = path.dirname(req.files[0].path);
      try {
        fs.rmdirSync(tempDirParent);
      } catch (err) {
        // Directory might not be empty, that's okay
      }
    }

    res.json({
      success: true,
      message: "Salon başarıyla güncellendi.",
      gym: updatedGym.rows[0],
    });
  } catch (error) {
    console.error("Update Gym Error:", error);

    // Cleanup uploaded files in case of error
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    }

    res.status(500).json({ message: "Salon güncellenirken hata oluştu." });
  }
};

// @desc    Salonu Sil
// @route   DELETE /api/gyms/:gymId
// @access  Private (Sadece Owner)
const deleteGym = async (req, res) => {
  const { gymId } = req.params;
  const owner_id = req.user.id;

  try {
    // Check if gym belongs to owner
    const gymCheck = await pool.query(
      "SELECT * FROM gyms WHERE id = $1 AND owner_id = $2",
      [gymId, owner_id],
    );

    if (gymCheck.rows.length === 0) {
      return res.status(403).json({ message: "Bu salonu silemezsiniz." });
    }

    // Delete related records first
    await pool.query("DELETE FROM reviews WHERE gym_id = $1", [gymId]);
    await pool.query("DELETE FROM bookings WHERE gym_id = $1", [gymId]);
    await pool.query("DELETE FROM gym_config WHERE gym_id = $1", [gymId]);

    // Then delete the gym
    await pool.query("DELETE FROM gyms WHERE id = $1 AND owner_id = $2", [
      gymId,
      owner_id,
    ]);

    res.json({
      success: true,
      message: "Salon başarıyla silindi.",
    });
  } catch (error) {
    console.error("Delete Gym Error:", error);
    res.status(500).json({ message: "Salon silinirken hata oluştu." });
  }
};

module.exports = {
  createGym,
  getAllGyms,
  getOwnerGyms,
  updateGym,
  getGymById,
  deleteGym,
};
