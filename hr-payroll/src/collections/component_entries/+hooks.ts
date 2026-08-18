import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { EntryOrigin } from '../../custom-types/entry_origin/+definition.js';
import { todayKey } from '../../lib/ui/calendar.js';
import {
	payrollWindows,
	sourceLock,
	sourceLockBlocksWrite,
	sourceLockMessage
} from '../../lib/scheduling/lock.js';
import type { Hooks, WorkspaceRow } from './$types.js';

function instalmentOrigin(value: EntryOrigin | null | undefined) {
	// The write boundary already decodes `origin` against the strict entry-origin schema, so a
	// value reaching the hook either carries a declared arm or was refused before it got here.
	// The narrowing is all that is left to do.
	return value != null && value.kind === 'LOAN_INSTALMENT' ? value : null;
}

const LIMIT = 5000;

type BeforeApi = Parameters<
	NonNullable<NonNullable<Hooks['create']>['before']>['handler']
>[0]['api'];

/**
 * Amounts are magnitudes. Direction comes from the pay component's policy and from the treatment,
 * and a correction is an entry whose `origin.kind` is `REVERSAL` — never a negative number.
 */
function assertMagnitude(value: number | null | undefined): void {
	if (value == null) return;
	const amount = Number(value);
	if (!Number.isFinite(amount)) {
		refuse('Amount must be a number.');
	}
	if (amount < 0) {
		refuse(
			'Amount is a magnitude and can never be negative. To take money back, record an entry whose origin is { kind: "REVERSAL", reverses_entry_id, reason }.'
		);
	}
}

type InstalmentEntry = {
	readonly employment_id: string;
	readonly pay_component_id: string;
	readonly amount: number;
	readonly event_date: string | Date;
	readonly pay_period?: string | null;
	readonly origin: EntryOrigin | null | undefined;
};

function assertInstalmentMatchesResolvedAgreement(
	entry: InstalmentEntry,
	agreement: WorkspaceRow<'repayment_agreements'> | undefined
): void {
	const origin = instalmentOrigin(entry.origin);
	if (!origin) return;
	if (!agreement?.schedule)
		refuse('A loan instalment must reference an existing repayment agreement.');
	const scheduled = agreement.schedule[origin.sequence - 1];
	if (
		!scheduled ||
		origin.of !== agreement.schedule.length ||
		entry.employment_id !== agreement.employment_id ||
		entry.pay_component_id !== agreement.pay_component_id ||
		Number(entry.amount) !== Number(scheduled.amount) ||
		String(entry.event_date).slice(0, 10) !== scheduled.due_date ||
		entry.pay_period !== scheduled.due_date.slice(0, 7)
	)
		refuse(
			'Loan instalments are generated from their repayment agreement. Edit the agreement schedule instead.'
		);

	// The partial unique index on the generated agreement/sequence projections is the concurrency-
	// safe duplicate guarantee, including two entries in one createMany statement. Pod translates
	// its 23505 into a caller-facing conflict; a sibling SELECT would add one round trip per instalment.
}

function assertEntrySourceUnlocked(
	api: BeforeApi,
	existing: WorkspaceRow<'component_entries'>,
	action: string
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const employment = yield* api.db.query.employments.findFirst({
			where: { norbital_id: { eq: existing.employment_id } },
			columns: { company_id: true }
		});
		if (employment == null) return;
		const [runs, lines] = yield* Effect.all(
			[
				api.db.query.payroll_runs.findMany({
					where: { company_id: { eq: employment.company_id } },
					columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
					limit: LIMIT
				}),
				api.db.query.payslip_lines.findMany({
					where: { component_entry_id: { eq: existing.norbital_id } },
					columns: { norbital_id: true },
					limit: 1
				})
			],
			{ concurrency: 'unbounded' }
		);
		const origin = existing.origin;
		const lock = sourceLock({
			existing: true,
			approvalId: existing.norbital_approval_id,
			dates: [existing.event_date],
			today: todayKey(),
			windows: payrollWindows(runs),
			consumedByPayslip: lines.length > 0,
			freezeWhenLive: origin?.kind === 'CLAIM'
		});
		if (sourceLockBlocksWrite(lock)) {
			refuse(sourceLockMessage(lock, action));
		}
	});
}

function assertInstalmentMatchesAgreement(
	api: BeforeApi,
	entry: InstalmentEntry
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const origin = instalmentOrigin(entry.origin);
		if (!origin) return;
		const agreement = (yield* api.db.query.repayment_agreements.findMany({
			where: { norbital_id: { eq: origin.agreement_id } },
			limit: 1
		}))[0];
		assertInstalmentMatchesResolvedAgreement(entry, agreement);
	});
}

export default {
	create: {
		before: {
			description:
				'Rejects a negative entry amount, and checks that a loan-instalment entry matches the amount, due date and pay period of the numbered instalment on its repayment agreement instead of being keyed in by hand.',
			batchHandler: ({ inputs, api }) =>
				Effect.gen(function* () {
					for (const input of inputs) assertMagnitude(input.amount);
					const agreementIds = [
						...new Set(
							inputs.flatMap((input) => {
								const origin = instalmentOrigin(input.origin);
								return origin ? [origin.agreement_id] : [];
							})
						)
					];
					if (agreementIds.length === 0) return inputs;
					if (agreementIds.length >= LIMIT)
						throw new Error(`Repayment agreements reached the ${LIMIT}-row safety limit.`);
					const agreements = yield* api.db.query.repayment_agreements.findMany({
						where: { norbital_id: { in: agreementIds } },
						limit: LIMIT
					});
					const byId = new Map(agreements.map((agreement) => [agreement.norbital_id, agreement]));
					for (const input of inputs) {
						const origin = instalmentOrigin(input.origin);
						if (!origin) continue;
						assertInstalmentMatchesResolvedAgreement(
							{
								employment_id: input.employment_id,
								pay_component_id: input.pay_component_id,
								amount: input.amount,
								event_date: input.event_date,
								pay_period: input.pay_period ?? null,
								origin: input.origin
							},
							byId.get(origin.agreement_id)
						);
					}
					return inputs;
				}),
			handler: ({ input, api }) =>
				Effect.gen(function* () {
					assertMagnitude(input.amount);
					yield* assertInstalmentMatchesAgreement(api, {
						employment_id: input.employment_id,
						pay_component_id: input.pay_component_id,
						amount: input.amount,
						event_date: input.event_date,
						pay_period: input.pay_period ?? null,
						origin: input.origin
					});
					return input;
				})
		}
	},
	update: {
		before: {
			description:
				'Refuses an approved claim, a past or payroll-consumed entry, then keeps an edited amount a positive magnitude and stops a loan instalment from being detached from its repayment agreement.',
			handler: ({ input, existing, api }) =>
				Effect.gen(function* () {
					yield* assertEntrySourceUnlocked(api, existing, 'Changing a pay entry');
					assertMagnitude(input.amount);
					const existingInstalment = instalmentOrigin(existing.origin);
					if (existingInstalment) {
						const nextOrigin = instalmentOrigin(input.origin ?? existing.origin);
						if (
							!nextOrigin ||
							nextOrigin.agreement_id !== existingInstalment.agreement_id ||
							nextOrigin.sequence !== existingInstalment.sequence
						)
							refuse(
								'Loan instalments cannot be detached from their repayment agreement. Edit the agreement schedule instead.'
							);
						yield* assertInstalmentMatchesAgreement(api, {
							employment_id: input.employment_id ?? existing.employment_id,
							pay_component_id: input.pay_component_id ?? existing.pay_component_id,
							amount: input.amount ?? existing.amount,
							event_date: input.event_date ?? existing.event_date,
							pay_period: input.pay_period ?? existing.pay_period,
							origin: input.origin ?? existing.origin
						});
					}
					return input;
				})
		}
	},
	delete: {
		before: {
			description:
				'Refuses deleting an approved claim or a payroll-consumed entry, and blocks deleting a loan instalment while its schedule row still exists.',
			handler: ({ existing, api }) =>
				Effect.gen(function* () {
					yield* assertEntrySourceUnlocked(api, existing, 'Deleting a pay entry');
					const origin = instalmentOrigin(existing.origin);
					if (!origin) return;
					const agreement = (yield* api.db.query.repayment_agreements.findMany({
						where: { norbital_id: { eq: origin.agreement_id } },
						limit: 1
					}))[0];
					if (agreement?.schedule?.[origin.sequence - 1])
						refuse(
							'Loan instalments cannot be deleted directly. Remove the unpaid row from the repayment agreement schedule.'
						);
				})
		}
	}
} satisfies Hooks;
