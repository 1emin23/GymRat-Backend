const express = require("express");
const router = express.Router();
const {
  getReviewsByGym,
  addReview,
  updateReview,
  deleteReview,
} = require("../controllers/reviewController");
const { protect } = require("../middlewares/authMiddleware");

router.get("/gym/:gymId", getReviewsByGym);
router.post("/", protect, addReview);
router.patch("/:id", protect, updateReview);
router.delete("/:id", protect, deleteReview);

module.exports = router;
