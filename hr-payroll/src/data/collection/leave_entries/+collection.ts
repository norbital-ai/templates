import * as Predicate from 'effect/Predicate';
import { collection, type TransformRow } from '@norbital-ai/bolt';
import { readLeaveContext } from '../../../lib/leave/context.js';
import { leaveActivityOf } from '../../../lib/leave/activity-fields.js';
import { timeOffRangeOf, type LeaveSubmission } from '../../../lib/leave/activity.js';
import { planLeaveBatch } from '../../../lib/leave/plan-batch.js';
import { previewLeave, type PreviewLeaveInput } from '../../../lib/leave/preview.js';
import { leaveBalanceSummaries } from '../../../lib/leave/summary.js';
import { plain } from '../../../lib/wire.js';
import { readAll } from '../../../lib/reads.js';
import { dateKey } from '../../../lib/iso-day.js';
import { getErrorMessage } from '../../../lib/refuse.js';
import { factValuesFault } from '../../../lib/declared-facts.js';
import type { FactKey } from '../../../lib/datatypes/fact_keys.js';
import { employmentCheckIssues, refuseChecks } from '../../../lib/checks.js';

/** Manual leave activities: create only, so an approved entry is immutable; a correction is a linked reversal and replacement. The payroll pin arrives as a `link` on the payslip that consumed the entry. */
const c = collection('leave_entries', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employment_id',
				'catalogue_id',
				'reference',
				'certificate_file',
				'from_date',
				'to_date',
				'half_day_start',
				'half_day_end',
				'no_pay_origin',
				'days',
				'hours',
				'encash_days',
				'encash_hours',
				'as_adjustment_entry',
				'reversal_of_id',
				'effective_on',
				'due_on',
				'destination_from',
				'destination_to',
				'available_from',
				'expires_on',
				'reason',
				'facts',
				'episode_id'
			]
		}
	},
	queries: {
		leave_balances: {
			description:
				'Computes annual leave balances and reservations from effective catalogue rules and manual activity as the calling user.',
			input: { employment_id: { kind: 'id', of: 'employments' }, as_of: { kind: 'date' } },
			output: { kind: 'json' }
		},
		leave_balance_report: {
			description:
				'Computes a bounded page of company leave balances as the calling user; next_cursor continues the report.',
			input: {
				company_id: { kind: 'id', of: 'companies' },
				as_of: { kind: 'date' },
				after: { kind: 'id', of: 'employments', optional: true }
			},
			output: { kind: 'json' }
		},
		preview_leave: {
			description:
				'Computes leave availability and dated charges from catalogue rules, employment history, manual activity and jurisdiction holidays using the same planner as approval.',
			input: {
				employment_id: { kind: 'id', of: 'employments' },
				catalogue_id: { kind: 'id', of: 'leave_catalogue' },
				/** A calendar month, YYYY-MM. */
				calendar_month: { kind: 'text', optional: true },
				hours: { kind: 'decimal', scale: 3, optional: true },
				no_pay_origin: {
					kind: 'enum',
					values: ['EMPLOYEE_REQUESTED', 'OTHER'],
					optional: true
				},
				range: {
					kind: 'object',
					optional: true,
					fields: {
						start: {
							kind: 'object',
							fields: {
								date: { kind: 'date' },
								half: { kind: 'enum', values: ['FIRST', 'SECOND'] }
							}
						},
						end: {
							kind: 'object',
							fields: {
								date: { kind: 'date' },
								half: { kind: 'enum', values: ['FIRST', 'SECOND'] }
							}
						}
					}
				},
				exclude_entry_id: { kind: 'id', of: 'leave_entries', optional: true }
			},
			output: { kind: 'json' }
		}
	},
	notifications: {
		// a held entry is somebody's decision: the step's approver teams get it in their inbox
		approvalStepRequested: [
			{
				channel: 'inbox',
				to: ['step_approvers'],
				title: 'Leave entry awaiting your decision',
				body: {
					one: 'A leave entry is held for approval.',
					many: '{count} leave entries are held for approval.'
				}
			}
		]
	}
});
export default c;

/**
 * A manual Leave activity, validated and frozen: its dated charges and credit allocations are
 * derived here, and each charge carries the calendar it was measured against. The batch is planned
 * against one read of the employments' history (`readLeaveContext`, as the workspace).
 */
c.transform(async (inputs, ctx) => {
	const rows = inputs.map(
		(input) =>
			plain(input) as Partial<LeaveSubmission> & {
				certificate_file?: unknown;
				facts?: Readonly<Record<string, unknown>> | null;
				episode_id?: string | null;
			}
	);
	const dates = rows.flatMap((row) => {
		const range = leaveActivityOf(row) === 'TIME_OFF' ? timeOffRangeOf(row) : null;
		return range == null
			? [
					row.from_date,
					row.to_date,
					row.effective_on,
					row.due_on,
					row.destination_from,
					row.destination_to
				].filter((date): date is string => date != null)
			: [range.start.date, range.end.date];
	});
	const window =
		dates.length === 0
			? undefined
			: {
					start: dates.toSorted()[0]!,
					end: dates.toSorted().at(-1)!
				};
	const context = await readLeaveContext(
		ctx.db,
		rows.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id])),
		window,
		rows.some((row) => leaveActivityOf(row) === 'REVERSAL')
	);
	const idsOf = (ids: readonly (string | null | undefined)[]) => ({
		id: { in: [...new Set(ids.flatMap((id) => (id == null ? [] : [id])))] }
	});
	const [catalogues, openers] = await Promise.all([
		readAll<{ id: string; code: string; event_facts: readonly FactKey[] | null }>(
			ctx.db,
			'leave_catalogue',
			idsOf(rows.map((row) => row.catalogue_id)),
			undefined,
			{ id: true, code: true, event_facts: true }
		),
		readAll<{ id: string; employment_id: string; leave_code: string; episode_id: string | null }>(
			ctx.db,
			'leave_entries',
			idsOf(rows.map((row) => row.episode_id)),
			undefined,
			{ id: true, employment_id: true, leave_code: true, episode_id: true }
		)
	]);
	for (const row of rows) {
		const catalogue = catalogues.find((entry) => entry.id === row.catalogue_id);
		const code = catalogue?.code ?? 'This leave';
		const fields = catalogue?.event_facts ?? [];
		const facts = row.facts ?? {};
		for (const key of Object.keys(facts))
			if (!fields.some((field) => field.key === key))
				ctx.refuse(`${code} does not declare the event fact ${key}.`, { field: 'facts' });
		// Time off records its event; a reversal, carry-forward, adjustment or encashment owes nothing.
		const fault = factValuesFault(
			fields,
			facts,
			leaveActivityOf(row) === 'TIME_OFF' && row.as_adjustment_entry !== true,
			undefined,
			() => true
		);
		if (fault != null) ctx.refuse(`${code}: ${fault}`, { field: 'facts' });
		if (row.episode_id == null) continue;
		const opener = openers.find((entry) => entry.id === row.episode_id);
		if (
			opener == null ||
			opener.employment_id !== row.employment_id ||
			opener.leave_code !== catalogue?.code
		)
			ctx.refuse('An episode continues an entry of the same leave on the same contract.', {
				field: 'episode_id'
			});
		if (opener!.episode_id != null)
			ctx.refuse('An episode is named by its first entry.', { field: 'episode_id' });
	}
	const planned = planLeaveBatch(context, rows);
	// The version's stored checks at LEAVE_ENTRY (E9), per time off on its first day.
	for (const [index, entry] of planned.entries()) {
		if (entry.activity !== 'TIME_OFF') continue;
		const employment = context.employments.find((row) => row.id === entry.employment_id);
		const charges = (entry.charges ?? []) as readonly {
			readonly date: string;
			readonly days: number;
		}[];
		const from = entry.from_date ?? charges[0]?.date;
		if (employment == null || from == null) continue;
		refuseChecks(
			await employmentCheckIssues(ctx.db, {
				at: 'LEAVE_ENTRY',
				employment,
				date: from,
				roots: {
					leave: {
						code: catalogues.find((row) => row.id === rows[index]!.catalogue_id)?.code ?? '',
						from,
						to: entry.to_date ?? charges.at(-1)?.date ?? from,
						days: charges.reduce((sum, charge) => sum + charge.days, 0),
						facts: rows[index]!.facts ?? {}
					}
				}
			}),
			(message) => ctx.refuse(message)
		);
	}
	// repository-health:allow R3b -- the planner speaks plain ids; the transform row brands them
	return planned.map((entry, index) => ({
		...entry,
		facts: rows[index]!.facts ?? {},
		episode_id: rows[index]!.episode_id ?? null
	})) as unknown as TransformRow<'leave_entries'>[];
});

/** Balances as the caller: the same read and rules as approval, over the caller's own grants. */
c.query('leave_balances', async (input, ctx) => {
	const { employment_id, as_of } = plain(input) as { employment_id: string; as_of: string };
	return leaveBalanceSummaries(
		{
			...(await readLeaveContext(ctx, [employment_id], { start: as_of, end: as_of })),
			balanceRead: true
		},
		employment_id,
		as_of
	);
});

/** Company balances: unresolved person-level inputs are reported beside that person's identity. */
c.query('leave_balance_report', async (input, ctx) => {
	const { company_id, as_of, after } = plain(input) as {
		company_id: string;
		as_of: string;
		after?: string;
	};
	const allEmployments = await readAll<{
		id: string;
		employee_id: string;
		employee_number: string;
	}>(
		ctx,
		'employments',
		{ company_id: { eq: company_id }, approval_id: { isNull: true } },
		undefined,
		{ id: true, employee_id: true, employee_number: true }
	);
	const remaining = allEmployments
		.toSorted((a, b) => a.id.localeCompare(b.id))
		.filter((row) => after == null || row.id > after);
	const employments = remaining.slice(0, 5);
	const next_cursor = remaining.length > employments.length ? employments.at(-1)!.id : null;
	const [context, employees] = await Promise.all([
		readLeaveContext(
			ctx,
			employments.map((row) => row.id),
			{ start: as_of, end: as_of }
		),
		readAll<{ id: string; name: string }>(
			ctx,
			'employees',
			{ id: { in: [...new Set(employments.map((row) => row.employee_id))] } },
			undefined,
			{ id: true, name: true }
		)
	]);
	const rows = context.employments
		.filter(
			({ effective_range: range }) =>
				range != null &&
				dateKey(range.start) <= as_of &&
				(range.end == null || dateKey(range.end) >= as_of)
		)
		.map((employment) => {
			const number = employments.find((row) => row.id === employment.id)?.employee_number ?? '';
			const identity = {
				employee_number: number,
				name: employees.find((row) => row.id === employment.employee_id)?.name ?? '',
				service_start: dateKey(employment.effective_range!.start)
			};
			try {
				return {
					...identity,
					balances: leaveBalanceSummaries({ ...context, balanceRead: true }, employment.id, as_of)
				};
			} catch (error) {
				if (!(Predicate.hasProperty(error, 'kind') && error.kind === 'refused')) throw error;
				return { ...identity, balances: [], issue: getErrorMessage(error) };
			}
		})
		.toSorted((a, b) => a.employee_number.localeCompare(b.employee_number));
	return { rows, next_cursor };
});

c.query('preview_leave', async (input, ctx) =>
	previewLeave(ctx, plain(input) as PreviewLeaveInput)
);
