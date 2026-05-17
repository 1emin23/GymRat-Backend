const pool = require("../config/db");
const path = require("path");
const fs = require("fs");

// ==================== KYC LIST (ALL / FILTERED) ====================
const getKycSubmissions = async (req, res) => {
  try {
    const { status } = req.query; // submitted | approved | rejected

    let query = `
      SELECT 
        ks.id,
        ks.user_id,
        ks.status,
        ks.submitted_at,
        ks.reviewed_at,
        ks.rejection_reason,
        ks.submission_count,
        u.full_name,
        u.email,
        u.role
      FROM kyc_submissions ks
      JOIN users u ON u.id = ks.user_id
    `;
    const params = [];

    if (status) {
      query += " WHERE ks.status = $1";
      params.push(status);
    }

    query += " ORDER BY ks.submitted_at DESC";

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      submissions: result.rows,
    });
  } catch (error) {
    console.error("Get KYC Submissions Error:", error);
    res.status(500).json({ success: false, message: "Sunucu hatası." });
  }
};

// ==================== KYC DETAIL (SINGLE USER) ====================
const getKycDetail = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT 
        ks.id,
        ks.user_id,
        ks.tax_plate_path,
        ks.business_license_path,
        ks.company_query_path,
        ks.status,
        ks.submitted_at,
        ks.reviewed_at,
        ks.reviewed_by,
        ks.rejection_reason,
        ks.submission_count,
        u.full_name,
        u.email,
        u.role,
        u.phone,
        u.created_at as user_created_at
      FROM kyc_submissions ks
      JOIN users u ON u.id = ks.user_id
      WHERE ks.user_id = $1
    `,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "KYC başvurusu bulunamadı.",
      });
    }

    res.json({
      success: true,
      submission: result.rows[0],
    });
  } catch (error) {
    console.error("Get KYC Detail Error:", error);
    res.status(500).json({ success: false, message: "Sunucu hatası." });
  }
};

// ==================== SERVE DOCUMENT (SECURE) ====================
const serveDocument = async (req, res) => {
  try {
    const { userId, type } = req.params;

    // Valid document types
    const validTypes = ["tax_plate", "business_license", "company_query"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: "Geçersiz belge tipi." });
    }

    // Fetch path from DB
    const result = await pool.query(
      "SELECT tax_plate_path, business_license_path, company_query_path FROM kyc_submissions WHERE user_id = $1",
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Belge bulunamadı." });
    }

    const docPath = result.rows[0][`${type}_path`];
    if (!docPath || !fs.existsSync(docPath)) {
      return res.status(404).json({ success: false, message: "Dosya bulunamadı." });
    }

    // Determine content type
    const ext = path.extname(docPath).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".pdf") contentType = "application/pdf";
    if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    if (ext === ".png") contentType = "image/png";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(docPath)}"`);
    fs.createReadStream(docPath).pipe(res);
  } catch (error) {
    console.error("Serve Document Error:", error);
    res.status(500).json({ success: false, message: "Sunucu hatası." });
  }
};

// ==================== APPROVE KYC ====================
const approveKyc = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;

    await pool.query("BEGIN");

    // Update kyc_submissions
    await pool.query(
      `UPDATE kyc_submissions 
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() 
       WHERE user_id = $2`,
      [adminId, userId],
    );

    // Update users
    await pool.query(
      "UPDATE users SET approval_status = 'approved' WHERE id = $1",
      [userId],
    );

    await pool.query("COMMIT");

    res.json({
      success: true,
      message: "İşletme onayı başarıyla tamamlandı.",
    });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("Approve KYC Error:", error);
    res.status(500).json({ success: false, message: "Sunucu hatası." });
  }
};

// ==================== REJECT KYC ====================
const rejectKyc = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "Reddetme sebebi en az 5 karakter olmalıdır.",
      });
    }

    await pool.query("BEGIN");

    // Update kyc_submissions
    await pool.query(
      `UPDATE kyc_submissions 
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2 
       WHERE user_id = $3`,
      [adminId, reason.trim(), userId],
    );

    // Update users
    await pool.query(
      "UPDATE users SET approval_status = 'rejected' WHERE id = $1",
      [userId],
    );

    await pool.query("COMMIT");

    res.json({
      success: true,
      message: "Başvuru reddedildi.",
    });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("Reject KYC Error:", error);
    res.status(500).json({ success: false, message: "Sunucu hatası." });
  }
};

// ==================== KYC STATS ====================
const getKycStats = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'submitted') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) as total
      FROM kyc_submissions
    `);

    res.json({
      success: true,
      stats: result.rows[0],
    });
  } catch (error) {
    console.error("Get KYC Stats Error:", error);
    res.status(500).json({ success: false, message: "Sunucu hatası." });
  }
};

module.exports = {
  getKycSubmissions,
  getKycDetail,
  serveDocument,
  approveKyc,
  rejectKyc,
  getKycStats,
};
