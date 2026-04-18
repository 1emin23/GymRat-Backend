const express = require("express");
const router = express.Router();
const { addReview } = require("../controllers/reviewController");
const { protect } = require("../middlewares/authMiddleware");

router.post("/", protect, addReview);

module.exports = router;
