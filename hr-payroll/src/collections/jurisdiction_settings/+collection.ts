import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { readRange, type StoredRange } from '../payroll_runs/lib/effective.js';
import { dateKey } from '../../lib/iso-day.js';
import { describeVersion, halfOpenOverlap, stableJson } from '../../lib/jurisdiction_settings.js';
import {
	catalogueCodesByVersion,
	refuseUnknownAssessedOnMentions,
	refuseUnknownMemberships,
	schemeFault
} from '../../lib/catalogue_rules.js';
import { openKeyMentions } from '../../lib/expressions/contexts.js';
import type { Row } from './$types.js';

/** The root's own columns: what the Settings form and the clone write. */
const columns = {
	code: true,
	jurisdiction_code: true,
	name: true,
	sealed_at: true,
	voided_at: true,
	void_reason: true,
	cloned_from_id: true,
	payroll: true,
	sources: true,
	work_rules: true,
	facts: true,
	change_summary: true,
	effective_range: true
} as const;

/** The rows a clone creates under a new version, each family's own columns minus the parent key. */
const children = {
	contribution_settings: {
		create: {
			columns: {
				code: true,
				name: true,
				authority: true,
				assessment_period: true,
				assessment_scope: true,
				elections: true,
				employee_share_annual_cap: true,
				shared_cap_group: true,
				project_relief_annually: true,
				rules: true,
				assessed_on: true,
				ordinary_on: true,
				parts: true,
				short_name: true,
				listing_order: true,
				listing_group: true
			}
		}
	},
	leave_catalogue_settings: {
		create: {
			columns: {
				code: true,
				name: true,
				authority: true,
				eligibility: true,
				evidence: true,
				is_npl: true,
				can_encash: true,
				encash_on_exit: true,
				pay_fraction: true,
				paid_by: true,
				consumes_code: true,
				unit: true,
				evidence_after_days: true,
				entitlement: true
			}
		}
	},
	loan_catalogue_settings: {
		create: {
			columns: {
				code: true,
				name: true,
				destination: true,
				direction: true,
				bands: true,
				loan_type: true,
				minimum_repayment: true,
				eligibility: true,
				evidence: true
			}
		}
	},
	claim_catalogue_settings: {
		create: {
			columns: {
				code: true,
				name: true,
				destination: true,
				direction: true,
				bands: true,
				eligibility: true,
				evidence: true,
				counts_toward: true
			}
		}
	},
	adhoc_catalogue_settings: {
		create: {
			columns: {
				code: true,
				name: true,
				authority: true,
				destination: true,
				direction: true,
				bands: true,
				eligibility: true,
				evidence: true,
				counts_toward: true,
				raised_by: true
			}
		}
	},
	allowance_catalogue_settings: {
		create: {
			columns: {
				code: true,
				name: true,
				authority: true,
				destination: true,
				direction: true,
				bands: true,
				eligibility: true,
				counts_toward: true
			}
		}
	}
} as const;

/** The two columns a sealed version may still take: the void, once. */
const VOID_COLUMNS = ['voided_at', 'void_reason'] as const;
/**
 * Operational configuration a sealed version may still take.
 *
 * Empty: the one member was the Google holiday source, and holidays are the entity's now, so the
 * source sits on `companies` where no seal governs it. Kept as the named exception so the next one
 * has somewhere to go rather than being written inline.
 */
const OPERATIONAL = [] as const;
/** Columns the runtime carries on every write and no rule reads. */
const CARRIED = ['id', 'row_version'] as const;

/**
 * Whether an edit to a sealed version's range only ends it earlier: the same start, and an end at
 * or before the stored one. Sealing a successor ends its predecessor this way; nothing else moves
 * a sealed range.
 */
function onlyShortens(stored: StoredRange | null, next: StoredRange | null): boolean {
	if (stored == null || next == null) return false;
	if (dateKey(stored.start) !== dateKey(next.start)) return false;
	if (next.end == null) return stored.end == null;
	if (dateKey(next.end) < dateKey(next.start)) return false;
	return stored.end == null || dateKey(next.end) <= dateKey(stored.end);
}

/** Every expression a version's work rules carry, for the entity-fact key check. */
function workRuleExpressions(work: Row['work_rules']): string[] {
	return [
		work.ordinary_divisor_days,
		work.overtime_when,
		...work.bands.flatMap((band) => [
			band.when,
			band.take_hours,
			band.price_amount,
			band.funnel_above_hours ?? ''
		]),
		...work.breaks.flatMap((brk) => [brk.when, brk.owed_minutes])
	];
}

/** Whether an input carries any nested row under the version. */
const carriesChildren = (input: Readonly<Record<string, unknown>>): boolean =>
	Object.keys(children).some((relation) => {
		const actions = input[relation];
		return (
			actions != null &&
			typeof actions === 'object' &&
			Object.values(actions as Record<string, unknown>).some(
				(entries) => Array.isArray(entries) && entries.length > 0
			)
		);
	});

/**
 * The sealed, shareable root of a jurisdiction lineage.
 *
 * Validates the payroll scope; freezes every column of a sealed version except a one-time void;
 * never unseals; requires a reason to void a version a paid payroll run cites; refuses sealing a
 * version whose range overlaps another sealed unvoided version of its code unless that version is
 * ended in the same write. A sealed version is never deleted, only voided: the delete grant
 * (`settingsGrants`) admits drafts alone.
 */
export default defineCollection({
	model,
	create: { input: { columns, with: children } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const sealing = inputs.flatMap((input, index) => {
				const row = existing[index];
				return row != null && row.sealed_at == null && input.sealed_at != null ? [row.id] : [];
			});
			const voiding = inputs.flatMap((input, index) => {
				const row = existing[index];
				return row != null && row.voided_at == null && input.voided_at != null ? [row.id] : [];
			});
			const codes = [
				...new Set(
					inputs.flatMap((input, index) => {
						const code = input.code ?? existing[index]?.code;
						return code == null ? [] : [String(code)];
					})
				)
			];
			// One wave: every read is keyed by the inputs and their stored rows.
			const membershipQuery = {
				where: { settings_id: { in: sealing }, approval_id: { isNull: true } },
				columns: { settings_id: true, code: true, counts_toward: true },
				limit: 5000
			} as const;
			const [versionRuns, schemes, catalogues, siblings, memberships] = yield* Effect.all(
				[
					voiding.length === 0
						? Effect.succeed([])
						: db.payroll_runs.findMany({
								where: { settings_id: { in: voiding } },
								columns: { id: true, period: true, settings_id: true },
								with: {
									payslip_payroll_run: {
										where: { status: { eq: 'PAID' } },
										columns: { id: true },
										limit: 1
									}
								},
								limit: 20_000
							}),
					sealing.length === 0
						? Effect.succeed([])
						: db.statutory_contributions.findMany({
								where: { settings_id: { in: sealing }, approval_id: { isNull: true } },
								columns: {
									settings_id: true,
									code: true,
									assessed_on: true,
									ordinary_on: true,
									parts: true,
									rules: true,
									elections: true
								},
								limit: 500
							}),
					catalogueCodesByVersion(db, sealing),
					codes.length === 0
						? Effect.succeed([])
						: db.jurisdiction_settings.findMany({
								where: {
									code: { in: codes },
									sealed_at: { isNotNull: true },
									voided_at: { isNull: true },
									approval_id: { isNull: true }
								},
								columns: {
									id: true,
									name: true,
									code: true,
									sealed_at: true,
									effective_range: true
								},
								limit: 500
							}),
					sealing.length === 0
						? Effect.succeed([])
						: Effect.map(
								Effect.all(
									[
										db.allowance_catalogue.findMany(membershipQuery),
										db.claim_catalogue.findMany(membershipQuery),
										db.adhoc_catalogue.findMany(membershipQuery)
									],
									{ concurrency: 'unbounded' }
								),
								([allowances, claims, adhoc]) => [
									...allowances.map((row) => ({ ...row, noun: 'Allowance' })),
									...claims.map((row) => ({ ...row, noun: 'Claim' })),
									...adhoc.map((row) => ({ ...row, noun: 'Ad hoc' }))
								]
							)
				],
				{ concurrency: 'unbounded' }
			);
			// What the batch says about each version's range, so a predecessor ended in the same
			// write counts.
			const ranges = new Map<string, StoredRange>();
			for (const [index, input] of inputs.entries()) {
				const row = existing[index];
				if (row == null || !('effective_range' in input)) continue;
				const range = readRange(input.effective_range);
				if (range != null) ranges.set(row.id, range);
			}
			return inputs.map((input, index) => {
				const stored = existing[index];
				const row = { ...stored, ...input };
				if (stored != null && stored.sealed_at != null) {
					if (carriesChildren(input))
						refuse(
							`${describeVersion(stored)} is sealed, so nothing can be added under it. Enact a new version instead.`
						);
					if (input.sealed_at === null)
						refuse(
							`${describeVersion(stored)} is never unsealed. Void it and seal a corrected version instead.`
						);
					for (const column of Object.keys(input)) {
						if ((CARRIED as readonly string[]).includes(column)) continue;
						if ((VOID_COLUMNS as readonly string[]).includes(column)) continue;
						if ((OPERATIONAL as readonly string[]).includes(column)) continue;
						if (
							stableJson(input[column as keyof typeof input]) ===
							stableJson(stored[column as keyof typeof stored])
						)
							continue;
						if (
							column === 'effective_range' &&
							onlyShortens(readRange(stored.effective_range), readRange(input.effective_range))
						)
							continue;
						refuse(
							`${describeVersion(stored)} is sealed, so ${column} cannot change. ` +
								'Enact a new version of the settings instead; a wrong seal is voided.'
						);
					}
					if (stored.voided_at != null && input.voided_at === null)
						refuse(`${describeVersion(stored)} is voided; a void is one action, never undone.`);
					if (
						stored.voided_at != null &&
						input.void_reason !== undefined &&
						input.void_reason !== stored.void_reason
					)
						refuse(`${describeVersion(stored)} is voided; its reason is part of the record.`);
					if (stored.voided_at == null && input.voided_at != null) {
						const paid = versionRuns.find(
							(run) => run.settings_id === stored.id && run.payslip_payroll_run.length > 0
						);
						if (paid != null && String(row.void_reason ?? '').trim() === '')
							refuse(
								`${describeVersion(stored)} priced the paid ${paid.period} payroll run, so voiding it states a reason.`
							);
					}
					return input;
				}
				// A draft, or a create: the whole row is checked.
				if (row.voided_at != null)
					refuse('Only a sealed version can be voided; delete a draft instead.');
				if (row.payroll?.currency == null || !String(row.jurisdiction_code ?? '').trim())
					refuse('Settings require a currency and payroll jurisdiction.');
				for (const [region, wage] of Object.entries(row.work_rules?.wages?.by_region ?? {}))
					if (!(Number(wage) > 0))
						refuse(`The minimum wage of region ${region} must be a positive amount.`);
				if (row.sealed_at == null) return input;
				// A sealing version's schemes each charge something: their formulas compile, and
				// every code and catalogue one names is a row of this version.
				if (stored != null) {
					const own = schemes.filter((scheme) => scheme.settings_id === stored.id);
					for (const scheme of own) {
						const fault = schemeFault({
							rules: scheme.rules,
							assessed_on: String(scheme.assessed_on ?? ''),
							ordinary_on: String(scheme.ordinary_on ?? ''),
							elections: scheme.elections ?? [],
							parts: scheme.parts ?? []
						});
						if (fault != null) refuse(`Scheme ${scheme.code} ${fault}`);
						refuseUnknownAssessedOnMentions(
							catalogues,
							stored.id,
							String(scheme.assessed_on ?? ''),
							`Scheme ${scheme.code}`
						);
					}
					// Every class of the version counts toward schemes the version has, by the parts
					// they declare — a membership nothing honours would read as "no base" at payroll.
					const ownParts = new Map(own.map((scheme) => [scheme.code, scheme.parts ?? []]));
					for (const row of memberships)
						if (row.settings_id === stored.id)
							refuseUnknownMemberships(ownParts, row.counts_toward, `${row.noun} ${row.code}`);
					// A `person.company.facts.<key>` mention is legal only when this version
					// declares the key and its type; otherwise a typo reads zero at payroll.
					const declaredFacts = new Set((row.facts ?? []).map((fact) => fact.key));
					const expressions = [
						...(row.work_rules == null ? [] : workRuleExpressions(row.work_rules)),
						...own.flatMap((scheme) => [
							scheme.assessed_on ?? '',
							...scheme.rules.flatMap((rule) => [rule.when, rule.employee, rule.employer])
						])
					];
					for (const expression of expressions)
						for (const key of [
							...openKeyMentions(expression, 'person.company.facts'),
							...openKeyMentions(expression, 'company.facts')
						])
							if (!declaredFacts.has(key))
								refuse(
									`This settings version reads company.facts.${key}, which it does not ` +
										'declare. Declare the entity fact (its key and type) on the version first.'
								);
				}
				// Sealing. The database exclusion holds the overlap too; the sentence is why it
				// happens here, and the batch is read so a predecessor ended in the same write counts.
				const range = readRange(row.effective_range);
				if (range == null) refuse('A sealed version states the period it governs.');
				for (const sibling of siblings) {
					if (sibling.code !== String(row.code)) continue;
					if (stored != null && sibling.id === stored.id) continue;
					const other = ranges.get(sibling.id) ?? readRange(sibling.effective_range);
					if (other != null && halfOpenOverlap(range, other))
						refuse(
							`Sealed ${String(row.code)} versions cannot overlap: ${sibling.name} already governs ` +
								// The bound is a stored instant; the operator set a day and reads a day back.
								`${dateKey(other.start)} to ${other.end == null ? 'open' : dateKey(other.end)}. ` +
								'Seal from the Settings timeline, which ' +
								'ends the previous version the day before this one begins.'
						);
				}
				return input;
			});
		})
});
