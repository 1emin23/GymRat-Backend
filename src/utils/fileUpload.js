const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ==================== GYM IMAGES UPLOAD ====================
// Storage: /gym_images/{gym_id}/ [Gym ID will be organized after gym is created]
// Temporary storage during upload
const gymImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user.id;
    const timestamp = Date.now();
    // Temporary upload folder: /gym_images/temp/{userId}_{timestamp}/
    const tempUploadDir = path.join(
      __dirname,
      "../../public/gym_images/temp",
      `${userId}_${timestamp}`,
    );

    // Create directory with recursive option
    fs.mkdirSync(tempUploadDir, { recursive: true }, (err) => {
      if (err && err.code !== "EEXIST") {
        return cb(err);
      }
    });

    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `gym_image_${timestamp}${ext}`);
  },
});

// File filter for gym images
const gymImageFilter = (req, file, cb) => {
  const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error("Only JPEG, PNG, WebP formats are allowed for gym images"),
      false,
    );
  }
};

// ==================== USER/OWNER AVATAR UPLOAD ====================
// Storage: /users/[user_id]/image
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user.id; // From authMiddleware
    const uploadDir = path.join(
      __dirname,
      "../../public/users",
      userId.toString(),
    );

    // Create directory with recursive option
    fs.mkdirSync(uploadDir, { recursive: true }, (err) => {
      if (err && err.code !== "EEXIST") {
        return cb(err);
      }
    });

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `image${ext}`);
  },
});

// File filter for avatars
const avatarFilter = (req, file, cb) => {
  const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error("Only JPEG, PNG, WebP formats are allowed for avatars"),
      false,
    );
  }
};

// ==================== GYM IMAGES SEQUENTIAL UPLOAD ====================
// Storage: /public/gyms/{gym_id}/images/ [1.jpg, 2.jpg, etc.]
const gymImagesSequentialStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const gymId = req.params.id || req.params.gymId;
    const uploadDir = path.join(
      __dirname,
      "../../public/gyms",
      gymId.toString(),
      "images",
    );

    // Create directory with recursive option
    fs.mkdirSync(uploadDir, { recursive: true }, (err) => {
      if (err && err.code !== "EEXIST") {
        return cb(err);
      }
    });

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const gymId = req.params.id || req.params.gymId;
    const uploadDir = path.join(
      __dirname,
      "../../public/gyms",
      gymId.toString(),
      "images",
    );

    // Find next available number
    let nextNumber = 1;
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      const numbers = files
        .map((f) => {
          const match = f.match(/^(\d+)\./);
          return match ? parseInt(match[1]) : 0;
        })
        .filter((n) => n > 0);
      if (numbers.length > 0) {
        nextNumber = Math.max(...numbers) + 1;
      }
    }

    // Get file extension
    const ext = path.extname(file.originalname).toLowerCase();
    const validExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext)
      ? ext
      : ".jpg";

    cb(null, `${nextNumber}${validExt}`);
  },
});

// ==================== EXPORT MIDDLEWARE ====================
// Gym images: multiple files with key "images"
exports.uploadGymImages = multer({
  storage: gymImageStorage,
  fileFilter: gymImageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
  },
}).array("images", 5); // Max 5 images per gym

// Gym images sequential: multiple files with key "images"
exports.uploadGymImagesSequential = multer({
  storage: gymImagesSequentialStorage,
  fileFilter: gymImageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
  },
}).array("images", 10); // Max 10 images

// Avatar: single file with key "avatar"
exports.uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: avatarFilter,
  limits: {
    fileSize: 3 * 1024 * 1024, // 3MB for avatar
  },
}).single("avatar");

// ==================== ERROR HANDLING MIDDLEWARE ====================
exports.handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "FILE_TOO_LARGE") {
      return res.status(400).json({
        success: false,
        message: "Dosya çok büyük. Maksimum boyut aşıldı.",
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Çok fazla dosya yüklendi.",
      });
    }
  }

  if (err && err.message) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  next();
};
