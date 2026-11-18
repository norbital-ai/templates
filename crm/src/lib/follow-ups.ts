/** Which reminder a follow-up is owed today, if any: each step is sent once, in order; and a qualified lead's next one. */
import type { CreateInput, Id } from '@norbital-ai/bolt';
import { DateTime, Duration } from 'effect';

export type Step = 'before' | 'due' | 'overdue' | 'escalated';
export type Reminder = 'none' | Step;
const ORDER: readonly Reminder[] = ['none', 'before', 'due', 'overdue', 'escalated'];
/** Days past due before a follow-up is escalated to whoever raised it. */
const ESCALATE_AFTER_DAYS = 3;

/**
 * The step owed on `today` (`YYYY-MM-DD`) for an open follow-up due on `due`, given the last step sent: the day before,
 * on the day, overdue from the day after, escalated `ESCALATE_AFTER_DAYS` days past due. `null` when nothing new is owed.
 * A follow-up created late skips the steps already past (one due today gets `due`, not `before` then `due`).
 */
export function reminderFor(due: string, today: string, sent: Reminder): Step | null {
	const late = Duration.toDays(
		DateTime.distance(DateTime.makeUnsafe(due), DateTime.makeUnsafe(today))
	);
	const owed: Step | null =
		late >= ESCALATE_AFTER_DAYS
			? 'escalated'
			: late >= 1
				? 'overdue'
				: late === 0
					? 'due'
					: late === -1
						? 'before'
						: null;
	return owed !== null && ORDER.indexOf(owed) > ORDER.indexOf(sent) ? owed : null;
}

const SUBJECT: { [S in Step]: string } = {
	before: 'Due tomorrow',
	due: 'Due today',
	overdue: 'Overdue',
	escalated: 'Overdue — escalated'
};

/** The reminder's mail subject and text. */
export function reminderMail(
	step: Step,
	f: { title: string; due_on: string; about: string | null }
) {
	const subject = `${SUBJECT[step]}: ${f.title}`;
	const text = [
		`${f.title}${f.about ? ` (${f.about})` : ''} is ${step === 'before' ? 'due tomorrow' : step === 'due' ? 'due today' : `overdue since ${f.due_on}`}.`,
		step === 'escalated'
			? `It is ${ESCALATE_AFTER_DAYS} or more days overdue, so whoever raised it is copied.`
			: '',
		'Mark it done in Follow-ups when it is handled.'
	]
		.filter(Boolean)
		.join('\n\n');
	return { subject, text };
}

/**
 * The follow-ups qualified leads are owed: one for each lead without an open follow-up, due `follow_up_days` after the
 * day (in `zone`) it was last touched, or today when that has passed or it was never touched; its owner is the lead's.
 */
export function leadFollowUps(
	leads: readonly {
		readonly id: Id<'companies'>;
		readonly name: string;
		readonly owner: Id<'sys_user'> | null;
		readonly follow_up_days: number;
	}[],
	touched: ReadonlyMap<Id<'companies'> | null, string | null>,
	open: ReadonlySet<Id<'companies'> | null>,
	today: string,
	zone: string
): CreateInput<'tasks'>[] {
	return leads.flatMap((lead) => {
		if (open.has(lead.id)) return [];
		const last = touched.get(lead.id) ?? null;
		const due =
			last === null
				? today
				: DateTime.formatIsoDate(
						DateTime.add(DateTime.makeZonedUnsafe(last, { timeZone: zone }), {
							days: lead.follow_up_days
						})
					);
		return [
			{
				kind: 'follow_up' as const,
				subject: `Follow up ${lead.name}`,
				due_on: due < today ? today : due,
				owner: lead.owner,
				company: lead.id
			}
		];
	});
}
