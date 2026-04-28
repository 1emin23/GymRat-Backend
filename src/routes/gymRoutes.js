const express = require("express");
const router = express.Router();
const {
  createGym,
  getAllGyms,
  seedTestData,
  getOwnerGyms,
  updateGym,
  deleteGym,
  getGymById,
} = require("../controllers/gymController");
const { setGymConfig } = require("../controllers/gymConfigController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const { uploadGymImages, handleUploadError } = require("../utils/fileUpload");

// Owner'ın kendi salonlarını getir - Must be before /:id routes
router.get("/owner/gyms", protect, authorize("owner"), getOwnerGyms);

// Herkes salonları görebilir
router.get("/", getAllGyms);

router.get("/:gymId", getGymById); // Detaylı salon bilgisi için aynı route'u kullanabiliriz, controller içinde ayrım yaparız

// Sadece giriş yapmış VE role: 'owner' olanlar salon ekleyebilir
router.post(
  "/",
  protect,
  authorize("owner"),
  uploadGymImages,
  handleUploadError,
  createGym,
);

// Salon config
router.post("/:gymId/config", protect, authorize("owner"), setGymConfig);

// Salonu güncelle ve sil
router.patch(
  "/:gymId",
  protect,
  authorize("owner"),
  uploadGymImages,
  handleUploadError,
  updateGym,
);
router.delete("/:gymId", protect, authorize("owner"), deleteGym);

module.exports = router;
