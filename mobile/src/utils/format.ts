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

/** "hace 5 min", "hace 2 h" o la fecha corta si ya pasó más de un día. */
export const formatAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 24 * 60) return `hace ${Math.floor(minutes / 60)} h`;

  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Bogota',
  });
};
