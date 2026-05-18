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
 * @body    { selected_days: boolean[7], apply_monthly: boolean, slots: [...] }
 *
 * UPSERT mantığı:
 *   - YENİ satır → remaining_quota = total_quota (tam kapasite)
 *   - MEVCUT satır (conflict) → remaining_quota korunur, total_quota değişirse fark eklenir/çıkarılır
 *     Formül: GREATEST(old_remaining - old_total + new_total, 0) → min 0, max yeni total_quota
 */
const setGymConfig = async (req, res) => {
  const { gymId } = req.params;
  const { selected_days, apply_monthly, slots } = req.body;
  const owner_id = req.user.id;
  console.log(
    "setgymconfig kotrollerındayız ",
    gymId,
    owner_id,
    selected_days,
    slots,
  );
  // ============ VALIDATION ============

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

  // Slot validasyonu
  const slotErrors = [];
  const normalizedSlots = slots
    .slice()
    .sort((a, b) => Number(a.slot_index) - Number(b.slot_index));

  const usedIndices = new Set();

  for (let i = 0; i < normalizedSlots.length; i++) {
    const slot = normalizedSlots[i];

    if (!slot.slot_index || ![1, 2, 3].includes(slot.slot_index)) {
      slotErrors.push({
        field: `slots[${i}].slot_index`,
        message: "slot_index must be 1, 2, or 3",
      });
      continue;
    }

    if (usedIndices.has(slot.slot_index)) {
      slotErrors.push({
        field: `slots[${i}].slot_index`,
        message: `Duplicate slot_index ${slot.slot_index}`,
      });
      continue;
    }
    usedIndices.add(slot.slot_index);

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

    if (slot.start_time >= slot.end_time) {
      slotErrors.push({
        field: `slots[${i}].end_time`,
        message: "end_time must be after start_time",
      });
    }

    if (slot.total_quota == null || slot.total_quota <= 0) {
      slotErrors.push({
        field: `slots[${i}].total_quota`,
        message: "Quota must be a positive integer",
      });
    }

    if (slot.price == null || slot.price < 0) {
      slotErrors.push({
        field: `slots[${i}].price`,
        message: "Price cannot be negative",
      });
    }
  }

  // Slot çakışma kontrolü (sıralı olduğu için slot[i].end_time <= slot[i+1].start_time olmalı)
  if (slotErrors.length === 0) {
    for (let i = 0; i < normalizedSlots.length - 1; i++) {
      if (normalizedSlots[i + 1].start_time < normalizedSlots[i].end_time) {
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
    // 1. Salon mevcut mu ve yetki kontrolü
    const gymExists = await client.query(
      "SELECT id, owner_id, opening_time, closing_time FROM gyms WHERE id = $1",
      [gymId],
    );

    if (gymExists.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gym not found",
      });
    }

    if (gymExists.rows[0].owner_id !== owner_id) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to configure this gym",
      });
    }

    // 1b. Slot sınırları: açılış/kapanış saatleri kontrolü
    // DB'den gelen saat HH:MM:SS olabilir, slot değerleri HH:MM → normalize et
    const rawOpening = gymExists.rows[0].opening_time;
    const rawClosing = gymExists.rows[0].closing_time;
    const gymOpening = rawOpening ? rawOpening.toString().slice(0, 5) : null;
    const gymClosing = rawClosing ? rawClosing.toString().slice(0, 5) : null;

    const slot1 = normalizedSlots.find((s) => s.slot_index === 1);
    if (slot1 && gymOpening && slot1.start_time < gymOpening) {
      slotErrors.push({
        field: "slots[0].start_time",
        message: "Slot 1 cannot start before the gym's opening time",
      });
    }

    const slot3 = normalizedSlots.find((s) => s.slot_index === 3);
    if (slot3 && gymClosing && slot3.end_time > gymClosing) {
      slotErrors.push({
        field: "slots[2].end_time",
        message: "Slot 3 cannot end after the gym's closing time",
      });
    }

    if (slotErrors.length > 0) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: slotErrors,
      });
    }

    // 2. Hedef tarihleri oluştur
    const targetDates = generateTargetDates(selected_days, apply_monthly);

    console.log("[DEBUG generateTargetDates]", {
      baseDate: dayjs().tz(TIMEZONE).startOf("day").format("YYYY-MM-DD HH:mm:ss Z"),
      nowRaw: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      nowTz: dayjs().tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss Z"),
      apply_monthly,
      daysToGenerate: apply_monthly ? 30 : 7,
      selected_days,
      targetDates,
    });

    if (targetDates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid dates generated",
      });
    }

    // 3. Transaction başlat
    await client.query("BEGIN");

    // 4. Eski şemadan kalan (slot_index NULL olan) satırları kapat
    //    Bu satırlar createGym'in eski kodundan kalma olabilir
    await client.query(
      `UPDATE gym_config SET is_open = FALSE
       WHERE gym_id = $1
       AND target_date = ANY($2)
       AND slot_index IS NULL`,
      [gymId, targetDates],
    );

    // 4b. Kullanıcının SEÇMEDİĞİ günlerin config'ini kapat (gelecek tarihlerde)
    //     Böylece sadece selected_days'teki günler is_open = TRUE kalır
    await client.query(
      `UPDATE gym_config
       SET is_open = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE gym_id = $1
         AND target_date >= CURRENT_DATE
         AND target_date <> ALL($2)`,
      [gymId, targetDates],
    );

    // 5. Her tarih × her slot için UPSERT
    //    ON CONFLICT (gym_id, target_date, slot_index) → akıllı kota güncellemesi
    //    Yeni satır: remaining_quota = total_quota (tam kapasite)
    //    Mevcut satır: remaining_quota = LEAST(GREATEST(old_remaining - old_total + new_total, 0), new_total)
    //    Bu sayede mevcut rezervasyonlar korunur, kota değişikliği orantılı yansıtılır
    let upsertedCount = 0;

    for (const date of targetDates) {
      for (const slot of normalizedSlots) {
        const result = await client.query(
          `INSERT INTO gym_config
            (gym_id, target_date, slot_index, start_time, end_time, total_quota, remaining_quota, price, is_open)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, TRUE)
           ON CONFLICT (gym_id, target_date, slot_index)
           DO UPDATE SET
             start_time  = EXCLUDED.start_time,
             end_time    = EXCLUDED.end_time,
             total_quota = EXCLUDED.total_quota,
             remaining_quota = LEAST(
               GREATEST(
                 gym_config.remaining_quota - gym_config.total_quota + EXCLUDED.total_quota,
                 0
               ),
               EXCLUDED.total_quota
             ),
             price    = EXCLUDED.price,
             is_open  = EXCLUDED.is_open,
             updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [
            gymId,
            date,
            slot.slot_index,
            slot.start_time,
            slot.end_time,
            slot.total_quota,
            slot.price,
          ],
        );
        upsertedCount += result.rowCount;
      }
    }

    // 6. Transaction commit
    await client.query("COMMIT");

    console.log("[DEBUG setGymConfig SUCCESS]", {
      gymId,
      upsertedCount,
      targetDates,
      dateRange: { from: targetDates[0], to: targetDates[targetDates.length - 1] },
    });

    res.status(200).json({
      success: true,
      message: "Gym configuration saved successfully",
      data: {
        gym_id: parseInt(gymId),
        records_upserted: upsertedCount,
        date_range: {
          from: targetDates[0],
          to: targetDates[targetDates.length - 1],
        },
        target_dates: targetDates,
        selected_days,
        apply_monthly,
      },
    });
  } catch (error) {
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
  const baseDate = dayjs().tz(TIMEZONE).startOf("day");
  const daysToGenerate = apply_monthly ? 30 : 7;
  const targetDates = [];

  for (let i = 0; i < daysToGenerate; i++) {
    const currentDate = baseDate.add(i, "day");
    const dayOfWeek = currentDate.day(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    // selected_days: 0=Monday, 1=Tuesday, ..., 6=Sunday
    // dayjs: 0=Sunday, 1=Monday, ..., 6=Saturday
    const selectedDaysIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const isSelected = selected_days[selectedDaysIndex] === true;
    console.log(`[DEBUG generateTargetDates] i=${i}, date=${currentDate.format("YYYY-MM-DD")}, dayOfWeek=${dayOfWeek}, selectedDaysIndex=${selectedDaysIndex}, isSelected=${isSelected}, selectedValue=${selected_days[selectedDaysIndex]}`);

    if (isSelected) {
      targetDates.push(currentDate.format("YYYY-MM-DD"));
    }
  }

  return targetDates;
}

module.exports = { setGymConfig };
