// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { instantRangeSchema } from '@norbital-ai/bolt/authoring';
import { accrualKeySchema } from './accrual_key/+definition.js';
import { componentDefinitionSchema } from './component_definition/+definition.js';
import { contributionTreatmentSchema } from './contribution_treatment/+definition.js';
import { eligibilityRulesSchema } from './eligibility_rules/+definition.js';
import { obligationInstalmentSchema } from './obligation_instalment/+definition.js';
import { leaveEntitlementSchema } from './leave_entitlement/+definition.js';
import { overtimeTreatmentScheduleSchema } from './overtime_treatment_schedule/+definition.js';
import { payComponentPolicySchema } from './pay_component_policy/+definition.js';

/**
 * What these custom types *refuse*, asserted rather than inferred.
 *
 * These schemas moved from zod to Effect `Schema`, and the whole risk of that move is invisible to
 * the value type: `z.strictObject` and `Schema.Struct` infer the same TypeScript shape while one
 * rejects an unknown key and the other silently strips it, and `z.number()` and `Schema.Number`
 * infer the same `number` while one rejects `NaN` and the other does not. A conversion that
 * type-checks can therefore stop validating without a single compiler error, so every rejection the
 * zod version made is stated here as a runtime fact.
 *
 * They go through `~standard` because that is the seam the platform actually validates a write
 * through — `describeInvalidCustomValue` calls it, not `decodeUnknownResult`. Asserting against a
 * different entry point would prove the schema can reject while leaving open whether the write path
 * ever asks it to.
 */

const refuses = (
	schema: { readonly '~standard': { readonly validate: (value: unknown) => unknown } },
	value: unknown
): boolean => {
	const result = schema['~standard'].validate(value);
	assert.ok(
		!(result instanceof Promise),
		'these schemas must validate synchronously; a write path cannot await one'
	);
	return (result as { readonly issues?: ReadonlyArray<unknown> }).issues !== undefined;
};

const accepts = (schema: Parameters<typeof refuses>[0], value: unknown): boolean =>
	!refuses(schema, value);

const RANGE = { start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T23:59:59.999Z' };

describe('instant_range', () => {
	it('accepts a pair of UTC instants', () => {
		assert.ok(accepts(instantRangeSchema, RANGE));
	});

	// The zod value declared both bounds optional and three of its five users left them that way.
	// Nothing downstream can price a half-open nested range, so both are now required — this is the
	// assertion that says the tightening is deliberate rather than an artefact of the conversion.
	it('refuses a range missing either bound', () => {
		assert.ok(refuses(instantRangeSchema, { start: RANGE.start }));
		assert.ok(refuses(instantRangeSchema, { end: RANGE.end }));
		assert.ok(refuses(instantRangeSchema, {}));
	});

	it('refuses a zoned or local spelling, as the ISO check it replaced did', () => {
		assert.ok(refuses(instantRangeSchema, { start: '2026-01-01T00:00:00+08:00', end: RANGE.end }));
		assert.ok(refuses(instantRangeSchema, { start: '2026-01-01T00:00:00', end: RANGE.end }));
		assert.ok(refuses(instantRangeSchema, { start: '2026-01-01', end: RANGE.end }));
	});

	// A pattern alone admits these; `Date` then rolls them into the following month, so a layer would
	// take effect on a day that does not exist.
	it('refuses a day the calendar does not have', () => {
		assert.ok(refuses(instantRangeSchema, { start: '2026-02-30T00:00:00.000Z', end: RANGE.end }));
		assert.ok(refuses(instantRangeSchema, { start: '2026-02-29T00:00:00.000Z', end: RANGE.end }));
		assert.ok(accepts(instantRangeSchema, { start: '2028-02-29T00:00:00.000Z', end: RANGE.end }));
		assert.ok(refuses(instantRangeSchema, { start: '2026-04-31T00:00:00.000Z', end: RANGE.end }));
	});

	it('refuses a key it does not declare rather than dropping it', () => {
		assert.ok(refuses(instantRangeSchema, { ...RANGE, strat: RANGE.start }));
	});
});

describe('accrual_key', () => {
	it('accepts both arms', () => {
		assert.ok(accepts(accrualKeySchema, { by: 'FLAT' }));
		assert.ok(accepts(accrualKeySchema, { by: 'SERVICE_MONTHS', band_from: 0 }));
	});

	// `Schema.Number` would accept every one of these; the `z.int().check(z.minimum(0))` it replaced
	// accepted none.
	it('refuses a band that is not a whole non-negative count', () => {
		assert.ok(refuses(accrualKeySchema, { by: 'SERVICE_MONTHS', band_from: -1 }));
		assert.ok(refuses(accrualKeySchema, { by: 'SERVICE_MONTHS', band_from: 1.5 }));
		assert.ok(refuses(accrualKeySchema, { by: 'SERVICE_MONTHS', band_from: Number.NaN }));
		assert.ok(
			refuses(accrualKeySchema, { by: 'SERVICE_MONTHS', band_from: Number.POSITIVE_INFINITY })
		);
	});

	it('refuses an excess key and an unknown arm', () => {
		assert.ok(refuses(accrualKeySchema, { by: 'FLAT', band_from: 1 }));
		assert.ok(refuses(accrualKeySchema, { by: 'SENIORITY' }));
	});
});

describe('contribution_treatment', () => {
	it('refuses a SPECIAL naming no rule', () => {
		assert.ok(accepts(contributionTreatmentSchema, { kind: 'SPECIAL', rule: 'capped' }));
		assert.ok(refuses(contributionTreatmentSchema, { kind: 'SPECIAL', rule: '' }));
		assert.ok(refuses(contributionTreatmentSchema, { kind: 'SPECIAL' }));
	});

	it('refuses an excess key', () => {
		assert.ok(refuses(contributionTreatmentSchema, { kind: 'UNSET', rule: 'capped' }));
	});
});

describe('eligibility_rules', () => {
	it('accepts an empty rule list, which means everyone', () => {
		assert.ok(accepts(eligibilityRulesSchema, []));
	});

	// An empty `in` is not "matches everything": it is a predicate nothing satisfies, so it would
	// disqualify every employee while looking like an unset filter.
	it('refuses a predicate whose list is empty', () => {
		assert.ok(refuses(eligibilityRulesSchema, [{ field: 'GENDER', in: [] }]));
		assert.ok(refuses(eligibilityRulesSchema, [{ field: 'DEPARTMENT', in: [] }]));
		assert.ok(refuses(eligibilityRulesSchema, [{ field: 'DEPARTMENT', in: [''] }]));
	});

	it('refuses a non-integer or negative service bound, and an unknown member', () => {
		assert.ok(accepts(eligibilityRulesSchema, [{ field: 'SERVICE_MONTHS', from: 0, to: null }]));
		assert.ok(refuses(eligibilityRulesSchema, [{ field: 'SERVICE_MONTHS', from: -1, to: null }]));
		assert.ok(
			refuses(eligibilityRulesSchema, [{ field: 'SERVICE_MONTHS', from: Number.NaN, to: null }])
		);
		assert.ok(
			refuses(eligibilityRulesSchema, [{ field: 'SERVICE_MONTHS', from: 0, to: null, until: 3 }])
		);
		assert.ok(refuses(eligibilityRulesSchema, [{ field: 'TENURE', in: ['X'] }]));
	});
});

describe('obligation_instalment', () => {
	// The only inline shape `obligations` keeps. What it does NOT carry is the point: no agreement
	// id, no sequence, no file — nothing a foreign key, a row predicate or a field grant would need
	// to reach. The arm rules that used to live in the union beside it (at least one instalment, at
	// most 600, and only on the SCHEDULED arm) are real-column rules now and are held by
	// `OBLIGATION_TERMS_MISMATCH` in `src/lib/obligation_refusals.test.ts`.
	it('accepts a dated positive instalment', () => {
		assert.ok(accepts(obligationInstalmentSchema, { due_date: '2026-04-30', amount: 500 }));
	});

	// `Schema.Natural` admits zero; the `z.positive()` this replaced does not. Instalment 0 of 0 is
	// not an instalment, and a schedule that holds one recovers nothing.
	it('refuses a zero or negative amount', () => {
		assert.ok(refuses(obligationInstalmentSchema, { due_date: '2026-04-30', amount: 0 }));
		assert.ok(refuses(obligationInstalmentSchema, { due_date: '2026-04-30', amount: -1 }));
		assert.ok(refuses(obligationInstalmentSchema, { due_date: '2026-04-30', amount: Number.NaN }));
	});

	it('refuses a due date the calendar does not have', () => {
		assert.ok(refuses(obligationInstalmentSchema, { due_date: '2026-02-30', amount: 500 }));
		assert.ok(
			refuses(obligationInstalmentSchema, { due_date: '2026-04-30T00:00:00Z', amount: 500 })
		);
	});

	// A member no instalment declares is refused rather than stripped. `sequence` is the one that
	// matters: an instalment's number is its position in the array, and a stored ordinal accepted
	// here would be a second copy of the index that can disagree with it.
	it('refuses a member the struct does not declare, sequence above all', () => {
		assert.ok(
			refuses(obligationInstalmentSchema, { due_date: '2026-04-30', amount: 500, sequence: 1 })
		);
		assert.ok(refuses(obligationInstalmentSchema, { due_date: '2026-04-30' }));
	});
});

describe('leave_entitlement', () => {
	const layer = {
		level: 'STATUTORY',
		key: { by: 'FLAT' },
		days: 8,
		authority: 'EA 1955',
		effective_range: RANGE
	};
	const entitlement = { merge: 'MAX_WITH_STATUTORY_FLOOR', layers: [layer] };

	it('accepts a statutory layer', () => {
		assert.ok(accepts(leaveEntitlementSchema, entitlement));
	});

	// `Schema.Number` admits both; `z.number()` admitted neither. A `NaN` entitlement survives every
	// merge and comparison without failing, so the balance silently becomes unprintable.
	it('refuses NaN, Infinity or negative days', () => {
		for (const days of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
			assert.ok(
				refuses(leaveEntitlementSchema, { ...entitlement, layers: [{ ...layer, days }] }),
				`days=${String(days)}`
			);
		}
	});

	it('refuses a layer citing no authority, and an employee layer without a UUID', () => {
		assert.ok(
			refuses(leaveEntitlementSchema, { ...entitlement, layers: [{ ...layer, authority: '' }] })
		);
		assert.ok(
			refuses(leaveEntitlementSchema, {
				...entitlement,
				layers: [{ ...layer, level: 'EMPLOYEE', employment_id: 'employment-1' }]
			})
		);
	});

	it('refuses an excess key at either depth', () => {
		assert.ok(refuses(leaveEntitlementSchema, { ...entitlement, cap: null }));
		assert.ok(
			refuses(leaveEntitlementSchema, { ...entitlement, layers: [{ ...layer, days_max: 9 }] })
		);
	});
});

describe('pay_component_policy', () => {
	const treatment = {
		statutory_contribution_id: '7f9c8b2e-4c1a-4d3b-9f6e-2a1b3c4d5e6f',
		authority: 'EPF Act',
		treatment: { kind: 'INCLUDE' },
		effective_range: RANGE
	};
	const policy = { kind: 'EARNING', settlement: 'ADD', statutory_treatments: [treatment] };

	it('accepts an earning that adds', () => {
		assert.ok(accepts(payComponentPolicySchema, policy));
	});

	// The arms differ only in two literals, so a settlement belonging to another arm must fail rather
	// than be accepted: a component stored settling in a direction nobody declared changes net pay.
	it('refuses a kind and settlement that do not belong together', () => {
		assert.ok(refuses(payComponentPolicySchema, { ...policy, settlement: 'DEDUCT' }));
		assert.ok(refuses(payComponentPolicySchema, { ...policy, kind: 'PENALTY' }));
	});

	it('refuses a treatment with no authority or a non-UUID contribution', () => {
		assert.ok(
			refuses(payComponentPolicySchema, {
				...policy,
				statutory_treatments: [{ ...treatment, authority: '' }]
			})
		);
		assert.ok(
			refuses(payComponentPolicySchema, {
				...policy,
				statutory_treatments: [{ ...treatment, statutory_contribution_id: 'epf' }]
			})
		);
	});

	it('refuses an excess key inside a nested treatment', () => {
		assert.ok(
			refuses(payComponentPolicySchema, {
				...policy,
				statutory_treatments: [{ ...treatment, capped: true }]
			})
		);
	});
});

describe('component_definition', () => {
	it('accepts each source the engine knows', () => {
		assert.ok(
			accepts(componentDefinitionSchema, { source: 'SCHEDULE', unit: 'MONEY', reducible: true })
		);
		assert.ok(
			accepts(componentDefinitionSchema, { source: 'FORMULA', unit: 'MONEY', expr: 'basic * 0.1' })
		);
		assert.ok(
			accepts(componentDefinitionSchema, {
				source: 'ENTRY',
				unit: 'MONEY',
				evidence: 'NONE',
				cap: null,
				settlement: 'PAYROLL'
			})
		);
	});

	it('refuses a formula with no expression', () => {
		assert.ok(refuses(componentDefinitionSchema, { source: 'FORMULA', unit: 'MONEY', expr: '' }));
	});

	/*
	 * A company cannot put overtime in its catalogue at all.
	 *
	 * Overtime is derived from time entries priced against the jurisdiction's own overtime rules,
	 * and a multiple that comes from statute is not a tenant's to configure. While these two arms
	 * existed, two companies in one jurisdiction could state different law and both be stored. The
	 * refusal below is the whole rule, at the only seam a write passes through.
	 */
	it('refuses an overtime source outright, whatever it carries', () => {
		const rule = { day_type: 'ORDINARY', measure: 'BEYOND_NORMAL', band_from: 0 };
		assert.ok(refuses(componentDefinitionSchema, { source: 'OVERTIME', rule, minimum: null }));
		assert.ok(refuses(componentDefinitionSchema, { source: 'OVERTIME', rule, minimum: 1.5 }));
		assert.ok(
			refuses(componentDefinitionSchema, {
				source: 'OVERTIME_EXCESS',
				after_total_work_hours: 12,
				rule,
				valued_at: 'ORDINARY_HOURLY'
			})
		);
		// And not by way of some other arm quietly accepting the keys either.
		assert.ok(refuses(componentDefinitionSchema, { source: 'SCHEDULE', unit: 'MONEY', rule }));
	});

	const capLayer = {
		level: 'ORGANISATION',
		eligibility: [],
		authority: 'Policy',
		award: { kind: 'FIXED', amount: 500 },
		reimbursement_percentage: 100,
		effective_range: RANGE
	};
	const entry = {
		source: 'ENTRY',
		unit: 'MONEY',
		evidence: 'REQUIRED',
		settlement: 'PAYROLL',
		cap: {
			period: 'CALENDAR_YEAR',
			matrix: { merge: 'MAX_WITH_STATUTORY_FLOOR', layers: [capLayer] },
			on_exceed: 'BLOCK'
		}
	};

	it('accepts a capped entry component', () => {
		assert.ok(accepts(componentDefinitionSchema, entry));
		assert.ok(accepts(componentDefinitionSchema, { ...entry, cap: null }));
	});

	// An empty matrix is not "no cap" — `cap: null` is. It is a cap with no layer to satisfy, so
	// every claim exceeds it.
	it('refuses a cap matrix with no layers', () => {
		assert.ok(
			refuses(componentDefinitionSchema, {
				...entry,
				cap: { ...entry.cap, matrix: { merge: 'MAX_WITH_STATUTORY_FLOOR', layers: [] } }
			})
		);
	});

	it('refuses a percentage outside 0-100 or a non-finite amount', () => {
		const withLayer = (patch: Record<string, unknown>) => ({
			...entry,
			cap: {
				...entry.cap,
				matrix: { merge: 'MAX_WITH_STATUTORY_FLOOR', layers: [{ ...capLayer, ...patch }] }
			}
		});
		assert.ok(refuses(componentDefinitionSchema, withLayer({ reimbursement_percentage: 101 })));
		assert.ok(refuses(componentDefinitionSchema, withLayer({ reimbursement_percentage: -1 })));
		assert.ok(
			refuses(componentDefinitionSchema, withLayer({ reimbursement_percentage: Number.NaN }))
		);
		assert.ok(
			refuses(
				componentDefinitionSchema,
				withLayer({ award: { kind: 'FIXED', amount: Number.POSITIVE_INFINITY } })
			)
		);
		assert.ok(refuses(componentDefinitionSchema, withLayer({ authority: '' })));
	});

	it('refuses an excess key at every depth', () => {
		assert.ok(
			refuses(componentDefinitionSchema, {
				source: 'SCHEDULE',
				unit: 'MONEY',
				reducible: true,
				minimum: 1.5
			})
		);
		assert.ok(
			refuses(componentDefinitionSchema, { ...entry, cap: { ...entry.cap, on_exceeded: 'BLOCK' } })
		);
	});
});

describe('overtime_treatment_schedule', () => {
	const entry = {
		authority: 'EPF Act 1991 s.2 — "wages" expressly excludes overtime payment',
		treatment: { kind: 'EXCLUDE' },
		effective_range: RANGE
	};

	it('accepts a schedule, including the successor an amendment writes', () => {
		assert.ok(accepts(overtimeTreatmentScheduleSchema, [entry]));
		assert.ok(
			accepts(overtimeTreatmentScheduleSchema, [
				{ ...entry, treatment: { kind: 'INCLUDE' } },
				{ ...entry, treatment: { kind: 'SPECIAL', rule: 'VN_OT_PREMIUM' } }
			])
		);
	});

	/*
	 * An empty schedule is a scheme nobody has decided, and it has to survive the schema so that
	 * VALIDATE can name the row and refuse the run. Refusing it here would move a payroll fault into
	 * a write error on an unrelated edit, and would make a jurisdiction unseedable until every
	 * scheme's overtime position had been researched in one sitting.
	 */
	it('accepts an empty schedule, which VALIDATE refuses rather than the schema', () => {
		assert.ok(accepts(overtimeTreatmentScheduleSchema, []));
	});

	it('refuses an entry with no cited authority', () => {
		assert.ok(refuses(overtimeTreatmentScheduleSchema, [{ ...entry, authority: '' }]));
	});

	it('refuses a treatment or a range the nested schemas would refuse on their own', () => {
		assert.ok(
			refuses(overtimeTreatmentScheduleSchema, [{ ...entry, treatment: { kind: 'NONE' } }])
		);
		assert.ok(
			refuses(overtimeTreatmentScheduleSchema, [
				{ ...entry, treatment: { kind: 'SPECIAL', rule: '' } }
			])
		);
		assert.ok(
			refuses(overtimeTreatmentScheduleSchema, [
				{ ...entry, effective_range: { start: RANGE.start } }
			])
		);
	});

	it('refuses an excess key rather than stripping it', () => {
		assert.ok(
			refuses(overtimeTreatmentScheduleSchema, [{ ...entry, statutory_contribution_id: 'x' }])
		);
	});
});
