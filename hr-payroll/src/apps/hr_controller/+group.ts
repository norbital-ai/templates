import { group } from '@norbital-ai/bolt/authoring';

/**
 * Seven apps, not eight.
 *
 * `+time_attendance.svelte` was retired: it held one chart and one editable attendance table,
 * and an app that is one chart is not an app. The chart is now Scheduling's "Exceptions" tab, its
 * import is on the board's action menu beside the roster import, and the table is deleted rather
 * than moved — a table of punches beside a board of person-days is two places to read the same
 * month, and only one of them knows what a rest day is. `docs/attendance-on-the-board-proposal.md`
 * §8.3 records the whole argument.
 *
 * There is no explicit child list here. Apps are discovered from the files in this directory, so
 * deleting the file is the whole retirement; `defaultChild` never pointed at it.
 */
export default group({
	label: 'HR Controller',
	description:
		'Everything the HR team runs for one legal entity: people and their engagements, the roster and the attendance behind a pay period, leave, loans, pay components, and the payroll runs that settle them.',
	icon: 'lucide:briefcase-business',
	defaultChild: 'people'
});
