import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { EntryOrigin } from '../../datatypes/entry_origin/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';
import { repaymentScheduleIssues } from './lib/repayment-schedule.js';

function instalmentOrigin(value: EntryOrigin | null | undefined) {
	// The write boundary already decodes `origin` against the strict entry-origin schema, so a
	// value reaching the hook either carries a declared arm or was refused before it got here.
	// The narrowing is all that is left to do.
	return value != null && value.kind === 'LOAN_INSTALMENT' ? value : null;
}

const LIMIT = 5000;
type ReadApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
>[0]['api'];

function checked<T>(rows: T[], what: string): T[] {
	if (rows.length >= LIMIT)
		refuse(`${what} reached the ${LIMIT}-row safety limit; the operation was not applied.`);
	return rows;
}

function agreementEntries(
	api: ReadApi,
	agreement: Pick<WorkspaceRow<'repayment_agreements'>, 'id'>
) {
	return Effect.map(
		api.db.query.component_entries.findMany({
			where: { repayment_agreement_id: { eq: agreement.id } },
			with: { entry_payslip_lines: { columns: { id: true } } },
			limit: LIMIT
		}),
		(rows) =>
			checked(rows, 'Component entries').map((row) => ({
				...row,
				entry_payslip_lines: Array.isArray(row.entry_payslip_lines) ? row.entry_payslip_lines : null
			}))
	);
}

/** "Consumed" is not a flag: it is the existence of the nested persisted source relation. */
function linkedEntryIds(
	entries: readonly {
		readonly id: string;
		readonly entry_payslip_lines: readonly object[] | null;
	}[]
): Set<string> {
	return new Set(
		entries
			.filter((entry) => entry.entry_payslip_lines != null && entry.entry_payslip_lines.length > 0)
			.map((entry) => entry.id)
	);
}

function protectPaidInstalments(
	api: ReadApi,
	existing: WorkspaceRow<'repayment_agreements'>,
	next: {
		readonly employment_id: string;
		readonly pay_component_id: string;
		readonly schedule: WorkspaceRow<'repayment_agreements'>['schedule'];
	}
): Effect.Effect<void, never, never> {
	return Effect.map(agreementEntries(api, existing), (entries) => {
		const linked = linkedEntryIds(entries);
		if (linked.size === 0) return;
		if (
			next.employment_id !== existing.employment_id ||
			next.pay_component_id !== existing.pay_component_id
		)
			refuse(
				'A repayment agreement with payslip-linked instalments cannot change employment or component.'
			);
		for (const entry of entries) {
			if (!linked.has(entry.id)) continue;
			const origin = instalmentOrigin(entry.origin);
			if (!origin) continue;
			const candidate = next.schedule?.[origin.sequence - 1];
			if (
				!candidate ||
				Number(candidate.amount) !== Number(entry.amount) ||
				candidate.due_date !== String(entry.event_date).slice(0, 10)
			)
				refuse(
					`Repayment ${origin.sequence} is linked to a payslip and cannot be changed or removed.`
				);
		}
	});
}

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Checks that the instalments add up to the principal and finish inside the agreement period, so a loan cannot be booked against a schedule that never clears it.',
				handler: ({ input }) => {
					const issues = repaymentScheduleIssues({
						principal: input.principal,
						effectiveRange: input.effective_range,
						schedule: input.schedule
					});
					if (issues.length > 0) refuse(issues.join(' '));
					return input;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks that the amended schedule still clears the principal inside the agreement period, and refuses to change the amount, due date, employment or component of any instalment already paid out on a payslip.',
				handler: ({ input, existing, api }) => {
					const principal = input.principal ?? existing.principal;
					const effectiveRange = input.effective_range ?? existing.effective_range;
					const schedule = input.schedule ?? existing.schedule;
					const scheduleIssues = repaymentScheduleIssues({ principal, effectiveRange, schedule });
					if (scheduleIssues.length > 0) refuse(scheduleIssues.join(' '));
					return Effect.as(
						protectPaidInstalments(api, existing, {
							employment_id: input.employment_id ?? existing.employment_id,
							pay_component_id: input.pay_component_id ?? existing.pay_component_id,
							schedule
						}),
						input
					);
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses to delete a repayment agreement at all, because it is the auditable record of what an employee owes; an unwanted balance is cleared by shortening the unpaid schedule.',
				handler: () => {
					refuse(
						'Repayment agreements are auditable records and cannot be deleted. Correct the unpaid schedule instead.'
					);
				}
			}
		}
	}
} satisfies Hooks;
