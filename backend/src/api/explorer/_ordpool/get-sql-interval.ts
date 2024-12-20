import { Interval } from './ordpool-statistics-interface';

export function getSqlInterval(interval: Interval): string | null {
  const match = interval?.match(/^(\d+)([hwdmy])$/);

  if (!match) {
    return null;
  }

  const amount = match[1];
  const unit = match[2];

  switch (unit) {
    case 'h': return `${amount} HOUR`;   // Hours
    case 'd': return `${amount} DAY`;    // Days
    case 'w': return `${amount} WEEK`;   // Weeks
    case 'm': return `${amount} MONTH`;  // Months
    case 'y': return `${amount} YEAR`;   // Years
    default: return null;
  }
}
