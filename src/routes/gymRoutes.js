const express = require("express");
const router = express.Router();
const {
  createGym,
  getAllGyms,
  seedTestData,
} = require("../controllers/gymController");
const { setGymConfig } = require("../controllers/gymConfigController");
const { protect, authorize } = require("../middlewares/authMiddleware");

// Herkes salonları görebilir
router.get("/", getAllGyms);

// Test verisi (geliştirme amaçlı)
router.get("/seed/test-data", seedTestData);

// Sadece giriş yapmış VE role: 'owner' olanlar salon ekleyebilir
router.post("/", protect, authorize("owner"), createGym);
router.post("/:gymId/config", protect, authorize("owner"), setGymConfig);

module.exports = router;
