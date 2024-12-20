import { Interval } from './ordpool-statistics-interface';

export function getSqlInterval(interval: Interval): string {

  if (!interval || typeof interval !== 'string') {
    throw new Error(`Invalid interval: ${interval}`);
  }

  const match = interval.match(/^(\d+)([hwdmy])$/);

  if (!match) {
    throw new Error(`Invalid interval: ${interval}`);
  }

  const amount = match[1];
  const unit = match[2];

  switch (unit) {
    case 'h': return `${amount} HOUR`;   // Hours
    case 'd': return `${amount} DAY`;    // Days
    case 'w': return `${amount} WEEK`;   // Weeks
    case 'm': return `${amount} MONTH`;  // Months
    case 'y': return `${amount} YEAR`;   // Years
    default: throw new Error(`Unsupported interval unit: ${unit}`);
  }
}
