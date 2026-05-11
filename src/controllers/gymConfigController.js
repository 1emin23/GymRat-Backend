const pool = require("../config/db");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "Europe/Istanbul";

/**
 * @desc    Spor salonu için haftalık konfigürasyon (slot'lar, açık günler, fiyatlar)
 * @route   POST /api/gyms/:gymId/config
 * @access  Private (Sadece Salon Sahibi)
 * @body    { selected_days: boolean[], apply_monthly: boolean, slots: [...] }
 */
const setGymConfig = async (req, res) => {
  const { gymId } = req.params;
  const { selected_days, apply_monthly, slots } = req.body;
  const owner_id = req.user.id;

  // ============ VALIDATION ============

  // 1. Payload yapısı kontrolü
  if (!Array.isArray(selected_days) || selected_days.length !== 7) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [
        {
          field: "selected_days",
          message: "selected_days must be array of 7 booleans",
        },
      ],
    });
  }

  if (typeof apply_monthly !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [
        {
          field: "apply_monthly",
          message: "apply_monthly must be a boolean",
        },
      ],
    });
  }

  if (!Array.isArray(slots) || slots.length !== 3) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [{ field: "slots", message: "Must have exactly 3 slots" }],
    });
  }

  // 2. En az bir gün seçili olmalı
  if (!selected_days.some((day) => day === true)) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [
        {
          field: "selected_days",
          message: "At least one day must be selected",
        },
      ],
    });
  }

  // 3. Slot'ları valide et
  const slotErrors = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];

    // Slot yapısı
    if (
      !slot.slot_index ||
      !slot.start_time ||
      !slot.end_time ||
      slot.total_quota === undefined ||
      slot.price === undefined
    ) {
      slotErrors.push({
        field: `slots[${i}]`,
        message: "Missing required slot fields",
      });
      continue;
    }

    // Slot index (1, 2, 3)
    if (![1, 2, 3].includes(slot.slot_index)) {
      slotErrors.push({
        field: `slots[${i}].slot_index`,
        message: "Invalid slot_index",
      });
    }

    // Zaman formatı (HH:MM)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(slot.start_time)) {
      slotErrors.push({
        field: `slots[${i}].start_time`,
        message: "Invalid time format (must be HH:MM)",
      });
    }
    if (!timeRegex.test(slot.end_time)) {
      slotErrors.push({
        field: `slots[${i}].end_time`,
        message: "Invalid time format (must be HH:MM)",
      });
    }

    // end_time > start_time
    if (slot.start_time >= slot.end_time) {
      slotErrors.push({
        field: `slots[${i}].start_time`,
        message: "Slot end time must be after start time",
      });
    }

    // Quota pozitif
    if (slot.total_quota <= 0) {
      slotErrors.push({
        field: `slots[${i}].total_quota`,
        message: "Quota must be positive",
      });
    }

    // Price negatif değil
    if (slot.price < 0) {
      slotErrors.push({
        field: `slots[${i}].price`,
        message: "Price cannot be negative",
      });
    }
  }

  // Slot çakışması kontrolü (slot N+1 start >= slot N end)
  if (!slotErrors.length) {
    for (let i = 0; i < slots.length - 1; i++) {
      if (slots[i + 1].start_time < slots[i].end_time) {
        slotErrors.push({
          field: `slots[${i + 1}].start_time`,
          message: `Slot ${i + 2} must not overlap with Slot ${i + 1}`,
        });
      }
    }
  }

  if (slotErrors.length > 0) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: slotErrors,
    });
  }

  // ============ DATABASE OPERATIONS ============

  const client = await pool.connect();

  try {
    // 1. Yetki Kontrolü: Bu salon gerçekten bu kullanıcıya mı ait?
    const gymCheck = await client.query(
      "SELECT id FROM gyms WHERE id = $1 AND owner_id = $2",
      [gymId, owner_id],
    );

    if (gymCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to configure this gym",
      });
    }

    // 2. Tarih listesi oluştur (selected_days + apply_monthly'e göre)
    const targetDates = generateTargetDates(selected_days, apply_monthly);

    if (targetDates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid dates generated",
      });
    }

    // 3. Transaction başla
    await client.query("BEGIN");

    // 4. Eski kayıtları sil (date range içinde)
    const minDate = targetDates[0];
    const maxDate = targetDates[targetDates.length - 1];

    await client.query(
      `DELETE FROM gym_config
       WHERE gym_id = $1 AND target_date BETWEEN $2 AND $3`,
      [gymId, minDate, maxDate],
    );

    // 5. Yeni kayıtları bulk insert
    const values = [];
    let paramIndex = 1;

    for (const date of targetDates) {
      for (const slot of slots) {
        values.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
        );
      }
    }

    const flatParams = [];
    for (const date of targetDates) {
      for (const slot of slots) {
        flatParams.push(
          gymId,
          date,
          slot.slot_index,
          slot.start_time,
          slot.end_time,
          slot.total_quota,
          slot.total_quota, // remaining_quota = total_quota (initially)
          slot.price,
        );
      }
    }

    const insertQuery = `
      INSERT INTO gym_config 
        (gym_id, target_date, slot_index, start_time, end_time, total_quota, remaining_quota, price)
      VALUES ${values.join(",")}
    `;

    await client.query(insertQuery, flatParams);

    // 6. Transaction commit
    await client.query("COMMIT");

    // 7. Success response
    const recordsCreated = targetDates.length * 3; // 3 slots per date

    res.status(200).json({
      success: true,
      message: "Gym configuration saved successfully",
      data: {
        gym_id: parseInt(gymId),
        records_created: recordsCreated,
        date_range: {
          from: minDate,
          to: maxDate,
        },
        selected_days,
        apply_monthly,
        slots_summary: slots.map(
          (s) =>
            `${s.slot_index}: ${s.start_time} - ${s.end_time} (${s.total_quota} spots @ ${s.price} TRY)`,
        ),
      },
    });
  } catch (error) {
    // Hata durumunda transaction'ı rollback et
    await client.query("ROLLBACK").catch(() => {});

    console.error("GymConfig Error:", error);
    res.status(500).json({
      success: false,
      message: "Database error",
      error: process.env.NODE_ENV === "development" ? error.message : {},
    });
  } finally {
    client.release();
  }
};

/**
 * Verilen selected_days ve apply_monthly bayrağına göre target tarihleri oluştur
 * @param {boolean[]} selected_days - 7 element dizi (0=Pzt, ..., 6=Paz)
 * @param {boolean} apply_monthly - true: 30 gün, false: 7 gün
 * @returns {string[]} YYYY-MM-DD formatında tarih dizisi
 */
function generateTargetDates(selected_days, apply_monthly) {
  const baseDate = dayjs().tz(TIMEZONE);
  const daysToGenerate = apply_monthly ? 30 : 7;
  const targetDates = [];

  let currentDate = baseDate;
  let daysMatched = 0;

  while (daysMatched < daysToGenerate) {
    const dayOfWeek = currentDate.day(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    // selected_days: 0=Monday, 1=Tuesday, ..., 6=Sunday
    // dayjs: 0=Sunday, 1=Monday, ..., 6=Saturday
    // Convert dayjs day (0-6 Sun-Sat) to selected_days index (0-6 Mon-Sun)
    const selectedDaysIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    if (selected_days[selectedDaysIndex] === true) {
      targetDates.push(currentDate.format("YYYY-MM-DD"));
      daysMatched++;
    }

    currentDate = currentDate.add(1, "day");
  }

  return targetDates;
}

module.exports = { setGymConfig };
