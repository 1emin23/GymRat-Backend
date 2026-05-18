const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'Europe/Istanbul';
const now = dayjs();
const nowTz = dayjs().tz(TIMEZONE);
const baseDate = dayjs().tz(TIMEZONE).startOf('day');

console.log('--- Day.js Timezone Test ---');
console.log('now (local):', now.format('YYYY-MM-DD HH:mm:ss'));
console.log('now (tz):', nowTz.format('YYYY-MM-DD HH:mm:ss Z'));
console.log('baseDate:', baseDate.format('YYYY-MM-DD HH:mm:ss Z'));
console.log('baseDate day():', baseDate.day());
console.log('');

const selected_days = [true, true, true, true, true, true, false];
const daysToGenerate = 7;
const targetDates = [];

for (let i = 0; i < daysToGenerate; i++) {
  const currentDate = baseDate.add(i, 'day');
  const dayOfWeek = currentDate.day();
  const selectedDaysIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const isSelected = selected_days[selectedDaysIndex] === true;
  console.log(`i=${i}, date=${currentDate.format('YYYY-MM-DD')}, dayOfWeek=${dayOfWeek}, selectedDaysIndex=${selectedDaysIndex}, isSelected=${isSelected}`);
  if (isSelected) {
    targetDates.push(currentDate.format('YYYY-MM-DD'));
  }
}

console.log('');
console.log('targetDates:', targetDates);
