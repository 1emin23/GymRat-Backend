const express = require("express");
const router = express.Router();
const {
  createGym,
  getAllGyms,
  searchGyms,
  getOwnerGyms,
  updateGym,
  deleteGym,
  getGymById,
  uploadGymImagesToExisting,
  getGymConfig,
  togglePublishGym,
  deleteGymImage,
} = require("../controllers/gymController");
const { setGymConfig } = require("../controllers/gymConfigController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  uploadGymImages,
  uploadGymImagesSequential,
  handleUploadError,
} = require("../utils/fileUpload");

// Owner'ın kendi salonlarını getir - Must be before /:id routes
router.get("/owner/gyms", protect, authorize("owner"), getOwnerGyms);

// Salon Ara (Isim ve Şehre Göre)
router.get("/search", searchGyms);

// Herkes salonları görebilir
router.get("/", getAllGyms);

// Get gym config (availability & pricing)
router.get("/:id/config", getGymConfig);

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

// Salonun Yayınlanma Durumunu Güncelle
router.post(
  "/:gymId/toggle-publish",
  protect,
  authorize("owner"),
  togglePublishGym,
);

// Upload images to existing gym
router.post(
  "/:id/images",
  protect,
  authorize("owner"),
  uploadGymImagesSequential,
  handleUploadError,
  uploadGymImagesToExisting,
);

// Delete a specific image from gym
router.delete(
  "/:gymId/images/:imagePath",
  protect,
  authorize("owner"),
  deleteGymImage,
);

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
