const pool = require("../config/db");
const bcrypt = require("bcryptjs");

async function createAdmin() {
  const args = process.argv.slice(2);
  const email = args[0];
  const password = args[1];
  const fullName = args[2] || "System Admin";

  if (!email || !password) {
    console.log("Kullanım: node src/utils/createAdmin.js <email> <password> [full_name]");
    console.log("Örnek: node src/utils/createAdmin.js admin@example.com Sifre123!");
    process.exit(1);
  }

  try {
    // Check if user exists
    const existing = await pool.query("SELECT id, role FROM users WHERE email = $1", [email.toLowerCase()]);

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (user.role === "admin") {
        console.log(`ℹ️  '${email}' zaten admin olarak mevcut.`);
        process.exit(0);
      }
      // Promote to admin
      await pool.query("UPDATE users SET role = 'admin', approval_status = 'approved' WHERE id = $1", [user.id]);
      console.log(`✅ '${email}' admin yetkisine yükseltildi.`);
      process.exit(0);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create admin user
    await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_verified, approval_status, birth_date, phone)
       VALUES ($1, $2, $3, 'admin', TRUE, 'approved', NULL, NULL)`,
      [fullName, email.toLowerCase(), passwordHash],
    );

    console.log(`✅ Admin hesabı başarıyla oluşturuldu:`);
    console.log(`   Email: ${email.toLowerCase()}`);
    console.log(`   Name:  ${fullName}`);
    console.log(`   Role:  admin`);
  } catch (err) {
    console.error("❌ Hata:", err.message);
    process.exit(1);
  }
}

createAdmin();
