/** Minutes before a restart at which the players are warned, after the warning period's own length. */
const WARNING_MARKS = [15, 10, 5, 4, 3, 2, 1];

/**
 * When the players hear of a restart, in minutes before it: the warning period itself, then the
 * marks below it, then 0, the restart itself. A 15-minute warning is 15, 10, 5, 4, 3, 2, 1, 0; a
 * 5-minute one 5, 4, 3, 2, 1, 0; none at all is only 0. Scheduled restarts and ARK updates both
 * count down on these.
 */
export function warningMarks(warningMinutes: number): number[] {
  const lead = Math.max(0, Math.floor(Number(warningMinutes) || 0));
  return [...new Set([lead, ...WARNING_MARKS.filter(minutes => minutes < lead), 0])];
}
