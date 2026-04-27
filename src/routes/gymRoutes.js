const express = require("express");
const router = express.Router();
const {
  createGym,
  getAllGyms,
  seedTestData,
  getOwnerGyms,
  updateGym,
  deleteGym,
} = require("../controllers/gymController");
const { setGymConfig } = require("../controllers/gymConfigController");
const { protect, authorize } = require("../middlewares/authMiddleware");

// Test verisi (geliştirme amaçlı) - Must be before /:id routes
router.get("/seed/test-data", seedTestData);

// Owner'ın kendi salonlarını getir - Must be before /:id routes
router.get("/owner/gyms", protect, authorize("owner"), getOwnerGyms);

// Herkes salonları görebilir
router.get("/", getAllGyms);

// Sadece giriş yapmış VE role: 'owner' olanlar salon ekleyebilir
router.post("/", protect, authorize("owner"), createGym);

// Salon config
router.post("/:gymId/config", protect, authorize("owner"), setGymConfig);

// Salonu güncelle ve sil
router.patch("/:gymId", protect, authorize("owner"), updateGym);
router.delete("/:gymId", protect, authorize("owner"), deleteGym);

module.exports = router;
