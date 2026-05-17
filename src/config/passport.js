const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const db = require("./db"); // mevcut db bağlantın

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      passReqToCallback: true, // state'ten role okumak için
    },
    async (req, _accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const fullName = profile.displayName || "Google User";
        if (!email) return done(new Error("Google account has no email"));

        // role bilgisini state'ten oku (frontend ?role=user|owner gönderiyor)
        let role = "user";
        try {
          const state = JSON.parse(
            Buffer.from(req.query.state || "", "base64").toString("utf8"),
          );
          if (state?.role === "owner") role = "owner";
        } catch {}

        // 1) email var mı?
        const { rows } = await db.query(
          "SELECT * FROM users WHERE email = $1 LIMIT 1",
          [email],
        );

        let user = rows[0];

        if (!user) {
          // 2) yoksa oluştur — Google'dan şifre gelmez, password_hash NULL kalır
          const insert = await db.query(
            `INSERT INTO users (full_name, email, password_hash, role, is_verified, approval_status)
             VALUES ($1, $2, NULL, $3, TRUE, 'pending')
             RETURNING *`,
            [fullName, email, role],
          );
          user = insert.rows[0];
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

module.exports = passport;
