export const dateKeyInTimeZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => ['year', 'month', 'day'].includes(part.type))
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

export const todayInHavana = () => dateKeyInTimeZone(new Date(), 'America/Havana');

export const addDaysToDateKey = (value, days) => {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

export const formatDuration = (minutes) => {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours && rest) return `${hours} h ${rest} min`;
  if (hours) return `${hours} h`;
  return `${rest} min`;
};

export const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(date);
};
