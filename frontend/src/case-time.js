const IST_OFFSET = '+05:30';
const clock = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23',
});
const inputClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatCaseTime(value, basis) {
  if (value == null || value === '') return 'Not supplied';
  if (basis === 'date_only' || /^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value).slice(0, 10);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${clock.format(date)} IST` : String(value);
}

export function caseTimeInput(value) {
  const parts = Object.fromEntries(inputClock.formatToParts(value).map(({ type, value }) => [type, value]));
  const { year, month, day, hour, minute, second } = parts;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export const caseTimeWithOffset = value => value + IST_OFFSET;
