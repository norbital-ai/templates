import { Effect, Result, Schema } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { EntryOrigin } from '../../datatypes/entry_origin/+definition.js';
import { sourceLock, sourceLockBlocksWrite, sourceLockMessage } from '../../lib/scheduling/lock.js';
import type { Hooks, WorkspaceRow } from './$types.js';

function instalmentOrigin(value: EntryOrigin | null | undefined) {
	// The write boundary already decodes `origin` against the strict entry-origin schema, so a
	// value reaching the hook either carries a declared arm or was refused before it got here.
	// The narrowing is all that is left to do.
	return value != null && value.kind === 'LOAN_INSTALMENT' ? value : null;
}

const LIMIT = 5000;

/**
 * The repayment agreements this batch of entries cites, read once.
 *
 * Only a `LOAN_INSTALMENT` entry cites one, and a payroll run writes a whole company's instalments
 * in a single call — so a read per entry was a read per employee with a loan. One for the batch now.
 * `prepare` decides nothing: the comparison against the agreement's schedule is still made once,
 * for one entry, by the same pure function the update path calls.
 */
interface ComponentEntryBatch {
	readonly agreements: ReadonlyMap<string, WorkspaceRow<'repayment_agreements'>>;
}

/** `Hooks` with what `prepare` returns filled in; see the note in `quote_lines/+hooks.ts`. */
type ComponentEntryHooks = CollectionHooks<
	WorkspaceSchema,
	'component_entries',
	ComponentEntryBatch
>;

type BeforeApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
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

type InstalmentEntry = Pick<
	WorkspaceRow<'component_entries'>,
	'employment_id' | 'pay_component_id' | 'amount' | 'event_date' | 'pay_period' | 'origin'
>;

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
	// safe duplicate guarantee, including two entries in one createMany statement. Bolt translates
	// its 23505 into a caller-facing conflict; a sibling SELECT would add one round trip per instalment.
}

/** The part of a consuming payslip line this check reads: the period that settled the entry. */
const consumingLineSchema = Schema.Struct({
	payslip_line_payslip: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				payslip_payroll_run: Schema.optional(
					Schema.NullOr(
						Schema.Struct({
							period: Schema.optional(Schema.NullOr(Schema.String))
						})
					)
				)
			})
		)
	)
});

function assertEntrySourceUnlocked(
	api: BeforeApi,
	existing: WorkspaceRow<'component_entries'>,
	action: string
): Effect.Effect<void, never, never> {
	/**
	 * The settlement lock, read on its own.
	 *
	 * Component entries already have a real foreign key from `payslip_lines.component_entry_id`.
	 * Reading that indexed relation is the consumption check; there is no second settlement row to
	 * write, reconcile, or load.
	 */
	return Effect.map(
		api.db.payslip_lines.findFirst({
			where: { component_entry_id: { eq: existing.id } },
			columns: { id: true },
			with: {
				payslip_line_payslip: {
					columns: { id: true },
					with: { payslip_payroll_run: { columns: { period: true } } }
				}
			}
		}),
		(line) => {
			let period: string | undefined;
			if (line != null) {
				const decoded = Schema.decodeUnknownResult(consumingLineSchema)(line);
				if (Result.isSuccess(decoded)) {
					period = decoded.success.payslip_line_payslip?.payslip_payroll_run?.period ?? undefined;
				}
			}
			const lock = sourceLock({
				existing: true,
				approvalId: existing.approval_id,
				dates: [],
				settledBy: line == null ? null : { period: period ?? 'linked payslip' },
				datePassed: 'IS_NOT_A_LOCK'
			});
			if (sourceLockBlocksWrite(lock)) {
				refuse(sourceLockMessage(lock, action));
			}
		}
	);
}

function assertInstalmentMatchesAgreement(
	api: BeforeApi,
	entry: InstalmentEntry
): Effect.Effect<void, never, never> {
	const origin = instalmentOrigin(entry.origin);
	if (!origin) return Effect.void;
	return Effect.map(
		api.db.repayment_agreements.findMany({
			where: { id: { eq: origin.agreement_id } },
			limit: 1
		}),
		(agreements) => assertInstalmentMatchesResolvedAgreement(entry, agreements[0])
	);
}

export default {
	create: {
		prepare: ({ inputs, api }) => {
			const agreementIds = [
				...new Set(
					inputs.flatMap((input) => {
						const origin = instalmentOrigin(input.origin);
						return origin ? [origin.agreement_id] : [];
					})
				)
			];
			// No instalment in the batch cites an agreement, so there is nothing to read.
			if (agreementIds.length === 0) {
				return Effect.succeed({
					agreements: new Map<string, WorkspaceRow<'repayment_agreements'>>()
				});
			}
			return Effect.map(
				api.db.repayment_agreements.findMany({
					where: { id: { in: agreementIds } },
					limit: LIMIT
				}),
				(agreements) => ({
					agreements: new Map(agreements.map((agreement) => [agreement.id, agreement]))
				})
			);
		},
		perRecord: {
			before: {
				description:
					'Rejects a negative entry amount, and checks that a loan-instalment entry matches the amount, due date and pay period of the numbered instalment on its repayment agreement instead of being keyed in by hand.',
				handler: ({ input, prepared }) => {
					assertMagnitude(input.amount);
					const origin = instalmentOrigin(input.origin);
					assertInstalmentMatchesResolvedAgreement(
						{
							employment_id: input.employment_id,
							pay_component_id: input.pay_component_id,
							amount: input.amount,
							event_date: input.event_date,
							pay_period: input.pay_period ?? null,
							origin: input.origin
						},
						origin == null ? undefined : prepared.agreements.get(origin.agreement_id)
					);
					return input;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Refuses a payroll-consumed entry, then keeps an edited amount a positive magnitude and stops a loan instalment from being detached from its repayment agreement.',
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
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a payroll-consumed entry, and blocks deleting a loan instalment while its schedule row still exists.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						yield* assertEntrySourceUnlocked(api, existing, 'Deleting a pay entry');
						const origin = instalmentOrigin(existing.origin);
						if (!origin) return;
						const agreement = (yield* api.db.repayment_agreements.findMany({
							where: { id: { eq: origin.agreement_id } },
							limit: 1
						}))[0];
						if (agreement?.schedule?.[origin.sequence - 1])
							refuse(
								'Loan instalments cannot be deleted directly. Remove the unpaid row from the repayment agreement schedule.'
							);
					})
			}
		}
	}
} satisfies ComponentEntryHooks;
