const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Türkiye Saat Dilimi (UTC+3)
 * Tüm tarih/saat işlemleri bu timezone'a göre yapılır.
 */
const TIMEZONE = "Europe/Istanbul";

/**
 * Şu anki Türkiye saatini döndürür
 * @returns {dayjs.Dayjs} Türkiye saatinde dayjs objesi
 */
function now() {
  return dayjs().tz(TIMEZONE);
}

/**
 * Verilen tarihi Türkiye saatine göre parse eder
 * @param {string|Date} dateInput - Parse edilecek tarih
 * @returns {dayjs.Dayjs} Türkiye saatinde dayjs objesi
 */
function parseDate(dateInput) {
  if (!dateInput) return null;

  // YYYY-MM-DD formatında ise, saat bilgisi eklenerek Türkiye saatinde parse et
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dayjs.tz(`${dateInput} 00:00:00`, "YYYY-MM-DD HH:mm:ss", TIMEZONE);
  }

  return dayjs(dateInput).tz(TIMEZONE);
}

/**
 * Tarihi YYYY-MM-DD formatında döndürür (Türkiye saatine göre)
 * @param {string|Date|dayjs.Dayjs} dateInput - Format edilecek tarih
 * @returns {string} YYYY-MM-DD formatında tarih
 */
function toISODate(dateInput) {
  if (!dateInput) return null;
  const date =
    dateInput instanceof dayjs ? dateInput : dayjs(dateInput).tz(TIMEZONE);
  return date.format("YYYY-MM-DD");
}

/**
 * PostgreSQL için tarih formatlar (YYYY-MM-DD HH:mm:ss)
 * @param {string|Date|dayjs.Dayjs} dateInput - Format edilecek tarih
 * @returns {string} PostgreSQL uyumlu format
 */
function formatForDB(dateInput) {
  if (!dateInput) return null;
  const date =
    dateInput instanceof dayjs ? dateInput : dayjs(dateInput).tz(TIMEZONE);
  return date.format("YYYY-MM-DD HH:mm:ss");
}

/**
 * İki tarih arasındaki saat farkını hesaplar
 * @param {string|Date} targetDate - Hedef tarih
 * @param {string|Date} fromDate - Başlangıç tarihi (varsayılan: şimdi)
 * @returns {number} Saat cinsinden fark
 */
function hoursUntil(targetDate, fromDate = null) {
  const target = parseDate(targetDate);
  const from = fromDate ? parseDate(fromDate) : now();

  if (!target || !from) return 0;

  return target.diff(from, "hour", true);
}

/**
 * Günün başlangıcını döndürür (00:00:00)
 * @param {string|Date|dayjs.Dayjs} dateInput - Tarih
 * @returns {dayjs.Dayjs} Günün başlangıcı
 */
function startOfDay(dateInput) {
  if (!dateInput) return null;
  const date =
    dateInput instanceof dayjs ? dateInput : dayjs(dateInput).tz(TIMEZONE);
  return date.startOf("day");
}

/**
 * Günün sonunu döndürür (23:59:59)
 * @param {string|Date|dayjs.Dayjs} dateInput - Tarih
 * @returns {dayjs.Dayjs} Günün sonu
 */
function endOfDay(dateInput) {
  if (!dateInput) return null;
  const date =
    dateInput instanceof dayjs ? dateInput : dayjs(dateInput).tz(TIMEZONE);
  return date.endOf("day");
}

/**
 * Bugünün tarihini YYYY-MM-DD formatında döndürür
 * @returns {string} Bugünün tarihi
 */
function today() {
  return now().format("YYYY-MM-DD");
}

/**
 * N gün sonrasının tarihini YYYY-MM-DD formatında döndürür
 * @param {number} days - Gün sayısı
 * @param {string|Date} fromDate - Başlangıç tarihi (varsayılan: bugün)
 * @returns {string} N gün sonrasının tarihi
 */
function addDays(days, fromDate = null) {
  const base = fromDate ? parseDate(fromDate) : now();
  return base.add(days, "day").format("YYYY-MM-DD");
}

/**
 * İki tarihin aynı gün olup olmadığını kontrol eder
 * @param {string|Date} date1 - İlk tarih
 * @param {string|Date} date2 - İkinci tarih
 * @returns {boolean} Aynı gün mü?
 */
function isSameDay(date1, date2) {
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);

  if (!d1 || !d2) return false;

  return d1.format("YYYY-MM-DD") === d2.format("YYYY-MM-DD");
}

/**
 * Tarihin geçmişte olup olmadığını kontrol eder
 * @param {string|Date} dateInput - Kontrol edilecek tarih
 * @returns {boolean} Geçmişte mi?
 */
function isPast(dateInput) {
  const date = parseDate(dateInput);
  if (!date) return false;
  return date.isBefore(now());
}

/**
 * Tarihin gelecekte olup olmadığını kontrol eder
 * @param {string|Date} dateInput - Kontrol edilecek tarih
 * @returns {boolean} Gelecekte mi?
 */
function isFuture(dateInput) {
  const date = parseDate(dateInput);
  if (!date) return false;
  return date.isAfter(now());
}

module.exports = {
  TIMEZONE,
  now,
  parseDate,
  toISODate,
  formatForDB,
  hoursUntil,
  startOfDay,
  endOfDay,
  today,
  addDays,
  isSameDay,
  isPast,
  isFuture,
  dayjs, // Export dayjs for advanced usage
};
