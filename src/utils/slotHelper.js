/**
 * Slot Helper Utilities
 *
 * Provides utility functions for working with the dynamic 3-slot reservation system.
 * Handles slot generation, availability checks, capacity validation, and time filtering.
 */

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "Europe/Istanbul";

/**
 * Get current time in Istanbul timezone
 * @returns {dayjs.Dayjs}
 */
function now() {
  return dayjs().tz(TIMEZONE);
}

/**
 * Parse a date string to Istanbul timezone
 * @param {string|Date} dateInput
 * @returns {dayjs.Dayjs}
 */
function parseDate(dateInput) {
  if (!dateInput) return null;
  return dayjs(dateInput).tz(TIMEZONE);
}

/**
 * Convert date to YYYY-MM-DD format
 * @param {string|Date|dayjs.Dayjs} dateInput
 * @returns {string}
 */
function toISODate(dateInput) {
  if (!dateInput) return null;
  const date =
    dateInput instanceof dayjs ? dateInput : dayjs(dateInput).tz(TIMEZONE);
  return date.format("YYYY-MM-DD");
}

/**
 * Check if a time slot is in the past
 * @param {string} dateStr - YYYY-MM-DD format
 * @param {string} timeStr - HH:mm:ss format (start time of slot)
 * @returns {boolean} - true if slot is in the past
 */
function isSlotInPast(dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;

  const slotDateTime = dayjs.tz(
    `${dateStr} ${timeStr}`,
    "YYYY-MM-DD HH:mm:ss",
    TIMEZONE,
  );
  const currentTime = now();

  return slotDateTime.isBefore(currentTime);
}

/**
 * Check if a slot is available (not in past and has capacity)
 * @param {string} dateStr - YYYY-MM-DD format
 * @param {string} startTimeStr - HH:mm:ss format
 * @param {number} currentCount - Current number of bookings
 * @param {number} maxCapacity - Max allowed bookings
 * @returns {boolean}
 */
function isSlotAvailable(dateStr, startTimeStr, currentCount, maxCapacity) {
  // Check if slot is in the past
  if (isSlotInPast(dateStr, startTimeStr)) {
    return false;
  }

  // Check if slot has capacity
  if (currentCount >= maxCapacity) {
    return false;
  }

  return true;
}

/**
 * Calculate capacity percentage
 * @param {number} currentCount
 * @param {number} maxCapacity
 * @returns {number} - Percentage (0-100)
 */
function getCapacityPercentage(currentCount, maxCapacity) {
  if (maxCapacity <= 0) return 0;
  return Math.round((currentCount / maxCapacity) * 100);
}

/**
 * Get capacity status label
 * @param {number} percentage
 * @returns {string} - e.g., "Available", "Nearly Full", "Full"
 */
function getCapacityStatus(percentage) {
  if (percentage >= 100) return "Full";
  if (percentage >= 80) return "Nearly Full";
  if (percentage >= 50) return "Moderate";
  return "Available";
}

/**
 * Format time for display (HH:mm)
 * @param {string} timeStr - HH:mm:ss format
 * @returns {string} - HH:mm format
 */
function formatTime(timeStr) {
  if (!timeStr) return "";
  return timeStr.substring(0, 5); // Extract HH:mm from HH:mm:ss
}

/**
 * Format slot display (e.g., "Morning (07:00 - 11:00)")
 * @param {object} slot - { slot_name, start_time, end_time }
 * @returns {string}
 */
function formatSlotDisplay(slot) {
  if (!slot) return "";
  const startTime = formatTime(slot.start_time);
  const endTime = formatTime(slot.end_time);
  const name = slot.slot_name || `Slot ${slot.slot_number || ""}`;
  return `${name} (${startTime} - ${endTime})`;
}

/**
 * Get slots for a specific date, filtered to exclude past slots
 * @param {Array} slots - Array of slot objects from database
 * @param {string} dateStr - YYYY-MM-DD format
 * @param {Array} slotReservations - Array of slot_reservations for this date
 * @returns {Array} - Filtered and enriched slots
 */
function getAvailableSlotsForDate(slots, dateStr, slotReservations = []) {
  if (!slots || !Array.isArray(slots)) return [];

  const reservationMap = new Map();
  for (const res of slotReservations) {
    reservationMap.set(res.slot_id, res);
  }

  return slots
    .filter((slot) => slot.is_active) // Only active slots
    .map((slot) => {
      const reservation = reservationMap.get(slot.id) || {
        current_count: 0,
        max_capacity: slot.max_capacity,
      };

      const currentCount = reservation.current_count || 0;
      const maxCapacity = reservation.max_capacity || slot.max_capacity;
      const isAvailable = isSlotAvailable(
        dateStr,
        slot.start_time,
        currentCount,
        maxCapacity,
      );
      const capacityPercent = getCapacityPercentage(currentCount, maxCapacity);

      return {
        ...slot,
        current_count: currentCount,
        max_capacity: maxCapacity,
        is_available: isAvailable,
        capacity_percent: capacityPercent,
        capacity_status: getCapacityStatus(capacityPercent),
        is_past: isSlotInPast(dateStr, slot.start_time),
        display_name: formatSlotDisplay(slot),
      };
    });
}

/**
 * Validate if a booking can be made for a specific slot on a specific date
 * @param {object} slot - Slot object
 * @param {string} dateStr - YYYY-MM-DD format
 * @param {number} currentCount - Current bookings for this slot on this date
 * @param {number} maxCapacity - Max capacity
 * @returns {object} - { valid: boolean, reason: string }
 */
function validateSlotBooking(slot, dateStr, currentCount, maxCapacity) {
  if (!slot) {
    return { valid: false, reason: "Slot not found" };
  }

  if (!slot.is_active) {
    return { valid: false, reason: "Slot is inactive" };
  }

  if (isSlotInPast(dateStr, slot.start_time)) {
    return { valid: false, reason: "Slot is in the past" };
  }

  if (currentCount >= maxCapacity) {
    return { valid: false, reason: "Slot is full" };
  }

  return { valid: true, reason: "OK" };
}

/**
 * Get time range string (e.g., "07:00 - 11:00")
 * @param {string} startTime - HH:mm:ss
 * @param {string} endTime - HH:mm:ss
 * @returns {string}
 */
function getTimeRange(startTime, endTime) {
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

module.exports = {
  now,
  parseDate,
  toISODate,
  isSlotInPast,
  isSlotAvailable,
  getCapacityPercentage,
  getCapacityStatus,
  formatTime,
  formatSlotDisplay,
  getAvailableSlotsForDate,
  validateSlotBooking,
  getTimeRange,
  TIMEZONE,
};
