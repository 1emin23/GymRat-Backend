const express = require("express");
const router = express.Router();
const { createGym, getAllGyms } = require("../controllers/gymController");
const { setGymConfig } = require("../controllers/gymConfigController");
const { protect, authorize } = require("../middlewares/authMiddleware");

// Herkes salonları görebilir
router.get("/", getAllGyms);

// Sadece giriş yapmış VE role: 'owner' olanlar salon ekleyebilir
router.post("/", protect, authorize("owner"), createGym);
router.post("/:gymId/config", protect, authorize("owner"), setGymConfig);

module.exports = router;
