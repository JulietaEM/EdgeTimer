export const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value || 0);

export const formatShortDate = (date: string) =>
  new Date(`${date}T12:00:00-05:00`).toLocaleDateString('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

export const normalizeTimeInput = (value: string) => {
  const clean = value.trim();
  const compactMatch = clean.match(/^(\d{1,2})(\d{2})$/);
  const splitMatch = clean.match(/^(\d{1,2})(?::(\d{1,2}))?$/);

  const hours = compactMatch ? Number(compactMatch[1]) : splitMatch ? Number(splitMatch[1]) : NaN;
  const minutes = compactMatch ? Number(compactMatch[2]) : splitMatch?.[2] ? Number(splitMatch[2]) : 0;

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return clean;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};
