const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "onboarding@resend.dev"; // Kendi domainin eklenene kadar

async function sendOtpEmail(to, otpCode) {
  try {
    const { data, error } = await resend.emails.send({
      from: `GymRat <${FROM_EMAIL}>`,
      to: [to],
      subject: "GymRat - E-posta Doğrulama Kodunuz",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <h2 style="color: #111827; text-align: center;">GymRat</h2>
          <p style="color: #374151; font-size: 16px;">Merhaba,</p>
          <p style="color: #374151; font-size: 16px;">E-posta adresinizi doğrulamak için 6 haneli kodunuz:</p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; background: #eff6ff; padding: 16px 32px; border-radius: 8px;">
              ${otpCode}
            </span>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Bu kod 10 dakika içinde geçersiz olacaktır.</p>
          <p style="color: #6b7280; font-size: 14px;">Eğer bu talebi siz yapmadıysanız, lütfen bu e-postayı dikkate almayın.</p>
        </div>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw new Error("E-posta gönderilemedi.");
    }

    return data;
  } catch (err) {
    console.error("Send OTP Email Error:", err);
    throw err;
  }
}

module.exports = { sendOtpEmail };
