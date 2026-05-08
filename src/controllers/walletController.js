const pool = require("../config/db");
const Stripe = require("stripe");

const stripeSecretKey =
  process.env.Stripe_Secret_Key || process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

// @desc    Cüzdana bakiye yükle (Simülasyon)
// @route   POST /api/wallet/deposit
// @access  Private
const depositMoney = async (req, res) => {
  const { amount, success_url, cancel_url } = req.body;
  const user_id = req.user.id;
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: "Geçersiz miktar." });
  }

  try {
    const origin = process.env.FRONTEND_URL || "http://localhost:5173";
    const safeSuccessUrl =
      typeof success_url === "string" && success_url.startsWith("http")
        ? success_url
        : `${origin}/wallet/success?session_id={CHECKOUT_SESSION_ID}`;
    const safeCancelUrl =
      typeof cancel_url === "string" && cancel_url.startsWith("http")
        ? cancel_url
        : `${origin}/wallet/cancel`;

    if (stripe) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        success_url: safeSuccessUrl,
        cancel_url: safeCancelUrl,
        metadata: {
          user_id: String(user_id),
          amount: String(numericAmount),
          kind: "wallet_deposit",
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "try",
              unit_amount: Math.round(numericAmount * 100),
              product_data: {
                name: "GymWallet Cuzdan Yukleme",
                description: `${numericAmount.toFixed(2)} TRY bakiye yukleme`,
              },
            },
          },
        ],
      });

      return res.json({
        success: true,
        checkout_url: session.url,
        session_id: session.id,
      });
    }

    // Stripe key yoksa dev fallback: bakiyeyi anında yukle.
    await pool.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
      [numericAmount, user_id],
    );

    await pool.query(
      "INSERT INTO wallet_transactions (user_id, amount, type) VALUES ($1, $2, $3)",
      [user_id, numericAmount, "deposit"],
    );

    res.json({
      success: true,
      message: `${numericAmount}₺ başarıyla yüklendi.`,
    });
  } catch (error) {
    console.error("Wallet deposit error:", error);
    res.status(500).json({ message: "Yükleme işlemi başarısız." });
  }
};

// @desc    Cüzdan özetini ve geçmişi getir
// @route   GET /api/wallet/summary
const getWalletSummary = async (req, res) => {
  const user_id = req.user.id;
  try {
    const userRes = await pool.query(
      "SELECT wallet_balance FROM users WHERE id = $1",
      [user_id],
    );
    const transactionsRes = await pool.query(
      `SELECT wt.*, g.name as gym_name 
             FROM wallet_transactions wt
             LEFT JOIN bookings b ON wt.booking_id = b.id
             LEFT JOIN gyms g ON b.gym_id = g.id
             WHERE wt.user_id = $1
             ORDER BY wt.created_at DESC`,
      [user_id],
    );

    res.json({
      success: true,
      balance: userRes.rows[0].wallet_balance,
      history: transactionsRes.rows,
    });
  } catch (error) {
    res.status(500).json({ message: "Cüzdan bilgileri alınamadı." });
  }
};

// @desc    Stripe session basariliysa bakiyeye yansit
// @route   POST /api/wallet/confirm-session
// @access  Private
const confirmStripeSession = async (req, res) => {
  const user_id = req.user.id;
  const { session_id } = req.body || {};

  if (!stripe) {
    return res
      .status(400)
      .json({ success: false, message: "Stripe aktif degil." });
  }
  if (!session_id || typeof session_id !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "Gecersiz session_id." });
  }

  const client = await pool.connect();
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const sessionUserId = Number(session?.metadata?.user_id);
    const sessionAmount = Number(session?.metadata?.amount);

    if (
      session.payment_status !== "paid" ||
      !Number.isFinite(sessionAmount) ||
      sessionAmount <= 0 ||
      sessionUserId !== user_id
    ) {
      return res.status(400).json({
        success: false,
        message: "Odeme henuz tamamlanmamis veya session gecersiz.",
      });
    }

    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id FROM wallet_transactions WHERE user_id = $1 AND description = $2 LIMIT 1",
      [user_id, `stripe:${session_id}`],
    );
    if (existing.rows.length > 0) {
      await client.query("COMMIT");
      return res.json({ success: true, already_processed: true });
    }

    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
      [sessionAmount, user_id],
    );
    await client.query(
      "INSERT INTO wallet_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)",
      [user_id, sessionAmount, "deposit", `stripe:${session_id}`],
    );
    await client.query("COMMIT");

    return res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Confirm stripe session error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Odeme onayi alinamadi." });
  } finally {
    client.release();
  }
};

module.exports = { depositMoney, getWalletSummary, confirmStripeSession };
