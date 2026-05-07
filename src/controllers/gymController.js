const pool = require("../config/db");
const fs = require("fs");
const path = require("path");

// @desc    Yeni Spor Salonu Oluştur
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
    daily_capacity,
    amenities,
  } = req.body;
  const owner_id = req.user.id;

  try {
    // 1. Yetki Kontrolü (Email/Phone verification engeli kaldırıldı)
    const ownerCheck = await pool.query(
      "SELECT id, role FROM users WHERE id = $1",
      [owner_id],
    );

    if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].role !== "owner") {
      return res
        .status(403)
        .json({ message: "Sadece salon sahipleri salon ekleyebilir." });
    }

    if (!name || !address || !city || !membership_price) {
      return res
        .status(400)
        .json({ message: "Salon adı, adres, şehir ve fiyat zorunludur." });
    }

    const lat = location_lat || 41.0082;
    const long = location_long || 28.9784;

    // 2. DB'ye ekle
    const newGym = await pool.query(
      `INSERT INTO gyms (owner_id, name, location_lat, location_long, description, address, city, phone, email, opening_time, closing_time, membership_price, amenities) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
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
        amenities || null,
      ],
    );

    const gymId = newGym.rows[0].id;

    // 3. Otomatik 30 Günlük gym_config oluşturma
    if (daily_capacity) {
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split("T")[0];
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
      "SELECT g.*, COALESCE(AVG(r.rating), 0) as avg_rating, COUNT(r.id) as review_count FROM gyms g LEFT JOIN reviews r ON g.id = r.gym_id GROUP BY g.id;",
    );
    res.json({ success: true, count: gyms.rows.length, data: gyms.rows });
  } catch (error) {
    res.status(500).json({ message: "Salonlar getirilemedi." });
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

// @desc Salonu Güncelle (Görseller dahil)
const updateGym = async (req, res) => {
  const { gymId } = req.params;
  const { name, description, address, city, membership_price, amenities } =
    req.body;

  try {
    const updatedGym = await pool.query(
      `UPDATE gyms SET name = $1, description = $2, address = $3, city = $4, 
             membership_price = $5, amenities = $6 WHERE id = $7 AND owner_id = $8 RETURNING *`,
      [
        name,
        description,
        address,
        city,
        membership_price,
        amenities,
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

    // Yeni resim yollarını oluştur (Ardışık: mevcut + 1)
    const newImagePaths = req.files.map((file, index) => {
      const nextIndex = currentImages.length + index + 1;
      return `/public/gyms/${id}/images/${nextIndex}.jpg`;
    });

    // Veritabanını güncelle
    const result = await pool.query(
      "UPDATE gyms SET images = array_cat(images, $1) WHERE id = $2 RETURNING images",
      [newImagePaths, id],
    );

    res.status(200).json({ success: true, images: result.rows[0].images });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Görsel yükleme hatası." });
  }
};

module.exports = {
  createGym,
  getAllGyms,
  getOwnerGyms,
  getGymById,
  getGymConfig,
  updateGym, // Eksik olabilir, ekle
  deleteGym, // Eksik olabilir, ekle
  uploadGymImagesToExisting, // Eksik olabilir, ekle
  // Diğer update/delete fonksiyonlarını da benzer sade mantıkla koruyabilirsin
};
