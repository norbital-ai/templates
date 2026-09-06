import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect, Result, Schema } from 'effect';
import { readRange, coversDate } from '../payroll_runs/lib/effective.js';
import {
	statutoryRegimeIssues,
	statutoryRegimeSchema
} from '../../datatypes/statutory_regime/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';
import { statutoryCatalogueProfile } from '../../lib/statutory_profile.js';

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
const REVISION_MEMBERS = ['supersedes_id', 'revision'] as const;

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
	for (const column of [...LAW_MEMBERS, ...REVISION_MEMBERS, 'name', 'effective_range']) {
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
					'Validates the atomic statutory regime so coverage is coherent, overtime bands do not overlap, and every limit identity is unique. Lifecycle moves only forward, and a successor is a coherent revision of its predecessor.',
				handler: ({ input, existing, api }) => {
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
					} else {
						assertLifecycleTransition(existing, input);
						if (existing.lifecycle !== 'DRAFT') assertSealedLawNotEdited(existing, input);
					}
					const predecessorId = input.supersedes_id ?? existing?.supersedes_id;
					if (predecessorId == null || (existing != null && existing.lifecycle !== 'DRAFT'))
						return input;
					return Effect.flatMap(
						api.db.jurisdictions.findFirst({
							where: { id: { eq: predecessorId }, approval_id: { isNull: true } }
						}),
						(predecessor) =>
							Effect.gen(function* () {
								if (predecessor == null || predecessor.lifecycle !== 'SEALED')
									refuse('A law revision must follow an approved sealed profile.');
								if (
									predecessor.code !== (input.code ?? existing?.code) ||
									predecessor.currency !== currency
								)
									refuse('A law revision retains its law family and currency.');
								const range = readRange(input.effective_range ?? existing?.effective_range);
								const priorRange = readRange(predecessor.effective_range);
								if (
									range == null ||
									priorRange == null ||
									range.start <= priorRange.start ||
									range.end != null
								)
									refuse(
										'A successor starts after its predecessor and remains effective until the next approved revision.'
									);
								if (!coversDate({ start: priorRange.start, end: null }, range.start))
									refuse('The predecessor cannot start after its successor.');
								if ((input.revision ?? existing?.revision) == null)
									refuse('A law revision must retain its source evidence.');
								const overrides = (input.revision ?? existing?.revision)?.contributions ?? [];
								if (overrides.length > 0) {
									const family = yield* api.db.jurisdictions.findMany({
										where: { code: { eq: predecessor.code }, approval_id: { isNull: true } },
										limit: 500
									});
									if (family.length >= 500)
										refuse('The law family exceeds the revision validation read ceiling.');
									const root = statutoryCatalogueProfile(family, predecessor);
									const schemes = yield* api.db.statutory_contributions.findMany({
										where: { statutory_profile_id: { eq: root.id }, approval_id: { isNull: true } },
										limit: 500
									});
									if (schemes.length >= 500)
										refuse(
											'The contribution catalogue exceeds the revision validation read ceiling.'
										);
									for (const override of overrides) {
										const scheme = schemes.find(
											(row) => row.id === override.statutory_contribution_id
										);
										if (scheme == null)
											refuse(
												'A contribution revision must reference an approved scheme in this law family.'
											);
										if (override.rates.some((rate) => rate.selector.by !== scheme.keyed_by))
											refuse(`Contribution ${scheme.code} requires ${scheme.keyed_by} rate bands.`);
									}
								}
								return input;
							})
					);
				}
			},
			after: {
				description:
					'A newly sealed statutory profile regenerates the leave ledger of every employment its law family governs.',
				handler: ({ record, previous, api }) =>
					Effect.gen(function* () {
						const sealedNow = record.lifecycle === 'SEALED' && record.approval_id == null;
						const sealedBefore =
							previous != null && previous.lifecycle === 'SEALED' && previous.approval_id == null;
						if (!sealedNow || sealedBefore) return;
						yield* api.automations.run('leave_ledger_refresh', { jurisdiction_code: record.code });
					})
			}
		}
	}
} satisfies Hooks;
