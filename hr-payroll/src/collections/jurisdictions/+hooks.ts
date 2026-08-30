import { refuse } from '@norbital-ai/bolt/authoring';
import { Result, Schema } from 'effect';
import {
	statutoryRegimeIssues,
	statutoryRegimeSchema
} from '../../datatypes/statutory_regime/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';

function assertRegime(regime: unknown, currency: string): void {
	const parsed = Schema.decodeUnknownResult(statutoryRegimeSchema)(regime);
	if (!Result.isSuccess(parsed)) return refuse('The statutory regime is incomplete or malformed.');
	const issues = statutoryRegimeIssues(parsed.success, currency);
	if (issues.length > 0) refuse(issues.join(' '));
}

/**
 * The members that ARE the law a run is computed under.
 *
 * `payroll_runs.statutory_snapshot_id` points at this row, and the engine read exactly these
 * members when it computed the payslips: the currency every amount was stated in, the year
 * boundary, the proration divisor, the ordinary-rate basis, the whole atomic regime, and the
 * statutory leave floors. They are editable on a DRAFT only — the amendment path is a successor
 * profile version, never an edit of a sealed one.
 */
const LAW_MEMBERS = [
	'code',
	'currency',
	'tax_year_start_month',
	'proration',
	'ordinary_rate_basis',
	'ordinary_rate_divisor',
	'regime',
	'statutory_leave'
] as const;

/**
 * The one bookkeeping a VOIDED profile still accepts.
 *
 * Per the immutability matrix, a SEALED or VOIDED profile takes lifecycle transitions only. The
 * void act writes `lifecycle`, `void_reason` and — once the successor is enacted —
 * `successor_profile_id`. Everything else on a sealed row is historical record.
 */
const VOID_BOOKKEEPING = ['lifecycle', 'void_reason', 'successor_profile_id'] as const;

/** Key-order-insensitive JSON, so two decodings of one custom value compare equal. */
function stableJson(value: unknown): string {
	if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	return `{${Object.entries(value)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, member]) => `${JSON.stringify(key)}:${stableJson(member)}`)
		.join(',')}}`;
}

/**
 * A sealed profile's law cannot be rewritten, whatever its runs' payment state.
 *
 * Runs cite SEALED profiles only (the pick gate refuses DRAFT), and a cited profile can move
 * only SEALED → VOIDED — both sealed states freeze the law, so no paid-run lookup is needed
 * here: the lifecycle alone is the freeze. This is the second lock after the approval flow that
 * gates the transition itself.
 */
function assertSealedLawNotEdited(
	existing: WorkspaceRow<'jurisdictions'>,
	input: Record<string, unknown>
): void {
	for (const column of [...LAW_MEMBERS, 'name', 'effective_range']) {
		if (!(column in input)) continue;
		if (stableJson(input[column]) === stableJson(existing[column as keyof typeof existing]))
			continue;
		refuse(
			`This statutory profile is ${existing.lifecycle}, so ${column} is part of the law runs ` +
				'were computed under and cannot change. Enact a successor profile version: void this ' +
				'one, correct the copy in its draft, and seal that after approval.'
		);
	}
}

/**
 * Lifecycle moves forward only: DRAFT → SEALED → VOIDED.
 *
 * A void answers "this version is wrong for its period" and names a successor — it is never
 * undone by regressing to DRAFT, and a voided profile is never re-sealed. A void states its
 * reason, because a sealed version retiring without one would leave the audit trail with a hole
 * exactly where somebody would look first.
 */
function assertLifecycleTransition(
	existing: WorkspaceRow<'jurisdictions'>,
	input: Record<string, unknown>
): void {
	const next = input.lifecycle;
	if (next == null || next === existing.lifecycle) return;
	const legal =
		(existing.lifecycle === 'DRAFT' && next === 'SEALED') ||
		(existing.lifecycle === 'SEALED' && next === 'VOIDED');
	if (!legal)
		refuse(
			`A statutory profile moves DRAFT → SEALED → VOIDED only; ${existing.lifecycle} cannot ` +
				`become ${String(next)}. Enact a successor version instead.`
		);
	if (next === 'VOIDED' && input.void_reason == null)
		refuse('Voiding a statutory profile states the reason it is retired.');
}

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Validates the atomic statutory regime so coverage is coherent, overtime bands do not overlap, and every limit identity is unique. Lifecycle moves forward only (DRAFT → SEALED → VOIDED, with a stated reason to void); a SEALED or VOIDED profile accepts lifecycle bookkeeping and nothing else.',
				handler: ({ input, existing }) => {
					const regime = input.regime ?? existing?.regime;
					const currency = input.currency ?? existing?.currency;
					// A create states both; an edit may restate neither and keep what is stored. `refuse`
					// returns `never`, so the call below sees them narrowed.
					if (regime == null || currency == null)
						refuse('A jurisdiction states its statutory regime and its currency.');
					assertRegime(regime, currency);
					// A void needs a version to retire; sealing at create is the approval flow's act.
					if (existing === undefined) {
						if (input.lifecycle === 'VOIDED')
							refuse('A statutory profile is created as a DRAFT or sealed draft, never VOIDED.');
						return input;
					}
					assertLifecycleTransition(existing, input);
					if (existing.lifecycle !== 'DRAFT') assertSealedLawNotEdited(existing, input);
					return input;
				}
			}
		}
	}
} satisfies Hooks;
