const express = require("express");
const router = express.Router();
const { createGym, getAllGyms } = require("../controllers/gymController");
const { protect, authorize } = require("../middlewares/authMiddleware");

// Herkes salonları görebilir
router.get("/", getAllGyms);

// Sadece giriş yapmış VE role: 'owner' olanlar salon ekleyebilir
router.post("/", protect, authorize("owner"), createGym);

module.exports = router;
