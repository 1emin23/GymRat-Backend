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
const { protect, authorize, requireApprovedOwner } = require("../middlewares/authMiddleware");
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

// Sadece giriş yapmış, role: 'owner' VE onaylı olanlar salon ekleyebilir
router.post(
  "/",
  protect,
  authorize("owner"),
  requireApprovedOwner,
  uploadGymImages,
  handleUploadError,
  createGym,
);

// Salon config
router.post("/:gymId/config", protect, authorize("owner"), requireApprovedOwner, setGymConfig);

// Salonun Yayınlanma Durumunu Güncelle
router.post(
  "/:gymId/toggle-publish",
  protect,
  authorize("owner"),
  requireApprovedOwner,
  togglePublishGym,
);

// Upload images to existing gym
router.post(
  "/:id/images",
  protect,
  authorize("owner"),
  requireApprovedOwner,
  uploadGymImagesSequential,
  handleUploadError,
  uploadGymImagesToExisting,
);

// Delete a specific image from gym
router.delete(
  "/:gymId/images/:imagePath",
  protect,
  authorize("owner"),
  requireApprovedOwner,
  deleteGymImage,
);

// Salonu güncelle ve sil
router.patch(
  "/:gymId",
  protect,
  authorize("owner"),
  requireApprovedOwner,
  uploadGymImages,
  handleUploadError,
  updateGym,
);
router.delete("/:gymId", protect, authorize("owner"), requireApprovedOwner, deleteGym);

module.exports = router;
