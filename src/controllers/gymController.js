const pool = require("../config/db");
const fs = require("fs");
const path = require("path");
const { addDays, today } = require("../utils/dateHelper");

// @desc    Yeni Spor Salonu Oluştur
const createGym = async (req, res) => {
  const {
    name,
    location_lat,
    location_long,
    description,
    address,
    city,
    district,
    phone,
    email,
    opening_time,
    closing_time,
    membership_price,
    daily_capacity,
    amenities,
  } = req.body;
  const owner_id = req.user.id;

  try {
    // 1. Yetki Kontrolü
    const ownerCheck = await pool.query(
      "SELECT id, role FROM users WHERE id = $1",
      [owner_id],
    );

    if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].role !== "owner") {
      return res
        .status(403)
        .json({ message: "Sadece salon sahipleri salon ekleyebilir." });
    }

    if (!name || !address || !city || !phone || !membership_price) {
      return res.status(400).json({
        message: "Salon adı, adres, şehir, telefon ve fiyat zorunludur.",
      });
    }

    const lat = location_lat || 41.0082;
    const long = location_long || 28.9784;

    // 2. DB'ye ekle
    const newGym = await pool.query(
      `INSERT INTO gyms (owner_id, name, location_lat, location_long, description, address, city, district, phone, email, opening_time, closing_time, membership_price, amenities, cover_image, is_published) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) 
       RETURNING *`,
      [
        owner_id,
        name,
        lat,
        long,
        description || null,
        address,
        city,
        district || null,
        phone,
        email || null,
        opening_time || "06:00",
        closing_time || "23:00",
        membership_price,
        amenities || null,
        null,
        false,
      ],
    );

    const gymId = newGym.rows[0].id;

    // 3. Otomatik 30 Günlük gym_config oluşturma (Türkiye saatine göre)
    if (daily_capacity) {
      for (let i = 0; i < 30; i++) {
        const dateStr = addDays(i);
        await pool.query(
          `INSERT INTO gym_config (gym_id, target_date, total_quota, remaining_quota, price, is_open)
           VALUES ($1, $2, $3, $3, $4, true)
           ON CONFLICT (gym_id, target_date) DO NOTHING`,
          [gymId, dateStr, daily_capacity, membership_price],
        );
      }
    }

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

const getAllGyms = async (req, res) => {
  try {
    const gyms = await pool.query(
      "SELECT g.*, COALESCE(AVG(r.rating), 0) as avg_rating, COUNT(r.id) as review_count FROM gyms g LEFT JOIN reviews r ON g.id = r.gym_id WHERE g.is_published = true GROUP BY g.id ORDER BY g.created_at DESC;",
    );
    res.json({ success: true, count: gyms.rows.length, data: gyms.rows });
  } catch (error) {
    res.status(500).json({ message: "Salonlar getirilemedi." });
  }
};

// @desc Salonları Ara (Isim ve Şehre Göre)
const searchGyms = async (req, res) => {
  const { q } = req.query;
  try {
    if (!q || typeof q !== "string" || q.trim().length === 0) {
      return res.json({ success: true, data: [] });
    }

    const searchTerm = `%${q.trim()}%`;
    const gyms = await pool.query(
      `SELECT g.*, COALESCE(AVG(r.rating), 0) as avg_rating, COUNT(r.id) as review_count 
       FROM gyms g 
       LEFT JOIN reviews r ON g.id = r.gym_id 
       WHERE g.is_published = true AND (LOWER(g.name) LIKE LOWER($1) OR LOWER(g.city) LIKE LOWER($1))
       GROUP BY g.id 
       ORDER BY g.name ASC 
       LIMIT 50`,
      [searchTerm],
    );
    res.json({ success: true, data: gyms.rows });
  } catch (error) {
    console.error("Search Error:", error);
    res.status(500).json({ message: "Arama yapılamadı." });
  }
};

const getGymById = async (req, res) => {
  const { gymId } = req.params;
  try {
    const gym = await pool.query(
      `SELECT g.*, COALESCE(AVG(r.rating), 0) as avg_rating, COUNT(r.id) as review_count 
       FROM gyms g LEFT JOIN reviews r ON g.id = r.gym_id 
       WHERE g.id = $1 GROUP BY g.id`,
      [gymId],
    );
    if (gym.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Salon bulunamadı." });
    res.json({ success: true, gym: gym.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Hata oluştu." });
  }
};

const getOwnerGyms = async (req, res) => {
  try {
    const gyms = await pool.query(
      "SELECT * FROM gyms WHERE owner_id = $1 ORDER BY created_at DESC",
      [req.user.id],
    );
    res.json({ success: true, items: gyms.rows });
  } catch (error) {
    res.status(500).json({ message: "Hata oluştu." });
  }
};

const getGymConfig = async (req, res) => {
  const { id } = req.params;
  try {
    const configs = await pool.query(
      `SELECT id, target_date, total_quota, remaining_quota, price, is_open
       FROM gym_config WHERE gym_id = $1 AND target_date >= CURRENT_DATE
       ORDER BY target_date ASC`,
      [id],
    );
    res.json({ success: true, data: configs.rows });
  } catch (error) {
    res.status(500).json({ message: "Konfigürasyon hatası." });
  }
};

// @desc Salonu Güncelle
const updateGym = async (req, res) => {
  const { gymId } = req.params;
  const {
    name,
    description,
    address,
    city,
    district,
    phone,
    membership_price,
    amenities,
    location_lat,
    location_long,
    cover_image,
  } = req.body;

  try {
    const updatedGym = await pool.query(
      `UPDATE gyms SET name = COALESCE($1, name), description = COALESCE($2, description), address = COALESCE($3, address), city = COALESCE($4, city), 
             district = COALESCE($5, district), phone = COALESCE($6, phone), membership_price = COALESCE($7, membership_price), amenities = COALESCE($8, amenities),
             location_lat = COALESCE($9, location_lat), location_long = COALESCE($10, location_long), cover_image = COALESCE($11, cover_image)
             WHERE id = $12 AND owner_id = $13 RETURNING *`,
      [
        name || null,
        description || null,
        address || null,
        city || null,
        district || null,
        phone || null,
        membership_price || null,
        amenities || null,
        location_lat || null,
        location_long || null,
        cover_image || null,
        gymId,
        req.user.id,
      ],
    );

    if (updatedGym.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Salon bulunamadı veya yetkiniz yok." });
    }

    res.json({ success: true, gym: updatedGym.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Güncelleme sırasında hata oluştu." });
  }
};

// @desc Salonun Yayınlanma Durumunu Aç/Kapat (Manual Toggle)
const togglePublishGym = async (req, res) => {
  const { gymId } = req.params;

  try {
    // Mevcut is_published durumunu getir
    const gymResult = await pool.query(
      `SELECT is_published FROM gyms WHERE id = $1 AND owner_id = $2`,
      [gymId, req.user.id],
    );

    if (gymResult.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Salon bulunamadı veya yetkiniz yok." });
    }

    const currentStatus = gymResult.rows[0].is_published;

    // Toggle et
    const updatedGym = await pool.query(
      `UPDATE gyms SET is_published = $1 WHERE id = $2 AND owner_id = $3 RETURNING *`,
      [!currentStatus, gymId, req.user.id],
    );

    res.json({
      success: true,
      message: !currentStatus
        ? "Salon yayınlandı."
        : "Salon taslak olarak kaydedildi.",
      gym: updatedGym.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "İşlem sırasında hata oluştu." });
  }
};

// @desc Salonu Sil (Görselleri fiziksel olarak temizler)
const deleteGym = async (req, res) => {
  const { gymId } = req.params;

  try {
    // 1. Önce salon bilgilerini ve resim yollarını al
    const gymResult = await pool.query(
      "SELECT images FROM gyms WHERE id = $1 AND owner_id = $2",
      [gymId, req.user.id],
    );

    if (gymResult.rows.length === 0) {
      return res.status(404).json({ message: "Salon bulunamadı." });
    }

    const images = gymResult.rows[0].images || [];

    // 2. Fiziksel dosyaları sil
    images.forEach((imagePath) => {
      const fullPath = path.join(__dirname, "..", imagePath); // Dosya yolunu oluştur
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath); // Dosyayı sil
      }
    });

    // 3. Klasörü sil (Eğer klasör boşsa)
    const gymDir = path.join(__dirname, "..", "public", "gyms", gymId);
    if (fs.existsSync(gymDir)) {
      fs.rmSync(gymDir, { recursive: true, force: true });
    }

    // 4. Veritabanından sil
    await pool.query("DELETE FROM gyms WHERE id = $1", [gymId]);

    res.json({
      success: true,
      message: "Salon ve ilgili tüm görseller silindi.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Silme işlemi başarısız." });
  }
};

// @desc Mevcut Salona Ardışık Görsel Ekle
const uploadGymImagesToExisting = async (req, res) => {
  const { id } = req.params;

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "Görsel yüklenmedi." });
    }

    // Mevcut resimleri al
    const currentGym = await pool.query(
      "SELECT images FROM gyms WHERE id = $1",
      [id],
    );
    const currentImages = currentGym.rows[0].images || [];

    // Yeni resim yollarını gerçek dosya adlarıyla oluştur.
    const newImagePaths = req.files.map(
      (file) => `/public/gyms/${id}/images/${file.filename}`,
    );

    // Veritabanını güncelle
    try {
      const result = await pool.query(
        `UPDATE gyms
         SET images = array_cat(COALESCE(images, '{}'), $1),
             cover_image_url = COALESCE(cover_image_url, $2)
         WHERE id = $3
         RETURNING images, cover_image_url`,
        [newImagePaths, newImagePaths[0] || null, id],
      );

      return res.status(200).json({
        success: true,
        images: result.rows[0].images,
        cover_image_url: result.rows[0].cover_image_url,
      });
    } catch (dbErr) {
      // Backward compatibility: cover_image_url column may not exist yet.
      if (
        dbErr &&
        typeof dbErr === "object" &&
        String(dbErr.message || "").includes("cover_image_url")
      ) {
        const fallback = await pool.query(
          "UPDATE gyms SET images = array_cat(COALESCE(images, '{}'), $1) WHERE id = $2 RETURNING images",
          [newImagePaths, id],
        );
        return res
          .status(200)
          .json({ success: true, images: fallback.rows[0].images });
      }
      throw dbErr;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Görsel yükleme hatası." });
  }
};

module.exports = {
  createGym,
  getAllGyms,
  searchGyms,
  getOwnerGyms,
  getGymById,
  getGymConfig,
  updateGym,
  togglePublishGym,
  deleteGym,
  uploadGymImagesToExisting,
};
