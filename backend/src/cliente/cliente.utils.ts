const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export interface ScheduleBlock {
  /** 1 = lunes ... 7 = domingo (ISO). */
  dia: number;
  inicio: string;
  fin: string;
}

/**
 * Resume el horario semanal para mostrarlo en una línea: agrupa los días
 * consecutivos con las mismas horas ("Lun a Vie 08:00–12:00, 14:00–18:00; Sáb 09:00–13:00").
 */
export function summarizeSchedule(blocks: ScheduleBlock[]): string {
  const byDay = new Map<number, string[]>();

  [...blocks]
    .filter((block) => block.dia >= 1 && block.dia <= 7)
    .sort((a, b) => a.dia - b.dia || a.inicio.localeCompare(b.inicio))
    .forEach((block) => {
      const list = byDay.get(block.dia) ?? [];
      list.push(`${block.inicio}–${block.fin}`);
      byDay.set(block.dia, list);
    });

  const groups: { days: number[]; hours: string }[] = [];

  for (const [dia, ranges] of [...byDay.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const hours = ranges.join(', ');
    const last = groups[groups.length - 1];

    if (
      last &&
      last.hours === hours &&
      last.days[last.days.length - 1] === dia - 1
    ) {
      last.days.push(dia);
    } else {
      groups.push({ days: [dia], hours });
    }
  }

  return groups
    .map(({ days, hours }) => {
      const first = DAY_NAMES[days[0] - 1];
      const last = DAY_NAMES[days[days.length - 1] - 1];
      const label =
        days.length === 1
          ? first
          : days.length === 2
            ? `${first} y ${last}`
            : `${first} a ${last}`;
      return `${label} ${hours}`;
    })
    .join('; ');
}

/** Primer nombre: las reseñas públicas no muestran el nombre completo del cliente. */
export function firstName(value: string | null | undefined): string {
  return value?.trim().split(/\s+/)[0] || 'Cliente';
}
