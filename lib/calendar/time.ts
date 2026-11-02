/** A reminder time is chosen by the user, never inferred from an incomplete notice. */
export function reminderLocalInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a complete reminder date and time in Eastern time.');
  const date = new Date(`${value}:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== value) throw new Error('Choose a valid date and time.');
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  // The two Eastern offsets also let us reject the repeated hour at fall DST.
  const matches = [4, 5].map(hours => new Date(date.getTime() + hours * 3600000))
    .filter(candidate => formatter.format(candidate).replace(' ', 'T') === value);
  if (matches.length !== 1) throw new Error(matches.length ? 'That Eastern time occurs twice when daylight saving ends. Choose a time outside the repeated hour.' : 'That Eastern time does not exist when daylight saving starts. Choose another time.');
  return matches[0].toISOString();
}
