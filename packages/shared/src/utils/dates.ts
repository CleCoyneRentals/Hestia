/**
 * Returns true if the given date is in the past (before now).
 */
export function isPast(date: Date): boolean {
  return date.getTime() < Date.now();
}

/**
 * Returns true if the given date is today (in UTC).
 */
export function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
}

/**
 * Adds N days to a date and returns a new Date.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Adds N months to a date and returns a new Date.
 * Handles month-end edge cases (e.g., Jan 31 + 1 month = Feb 28).
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  // If the day overflowed (e.g., 31 -> next month), set to last day of target month
  if (result.getUTCDate() !== day) {
    result.setUTCDate(0);
  }
  return result;
}

/**
 * Adds N years to a date and returns a new Date.
 */
export function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}
