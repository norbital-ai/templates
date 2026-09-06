// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { instantRangeSchema } from '@norbital-ai/bolt/authoring';
import { componentDefinitionSchema } from '../src/datatypes/component_definition/+definition.js';
import { contributionTreatmentSchema } from '../src/datatypes/contribution_treatment/+definition.js';
import { eligibilityRulesSchema } from '../src/datatypes/eligibility_rules/+definition.js';
import { componentEntryEventSchema } from '../src/datatypes/component_entry_event/+definition.js';
import { leaveEntitlementSchema } from '../src/datatypes/leave_entitlement/+definition.js';
import { overtimeTreatmentScheduleSchema } from '../src/datatypes/overtime_treatment_schedule/+definition.js';
import { payComponentPolicySchema } from '../src/datatypes/pay_component_policy/+definition.js';
import { statutoryLeaveProfileSchema } from '../src/datatypes/statutory_leave_profile/+definition.js';

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

describe('component_entry_event', () => {
	// The union that states WHY a component entry exists. What it does NOT carry is the point: no
	// employment, no component, no amount — those are columns on the row, because a foreign key and
	// a field grant cannot reach inside a blob. The arm rules beside it are held by
	// `COMPONENT_ENTRY_EVENT_MISMATCH` in `tests/lib/component_entry_refusals.test.ts`.
	it('accepts each arm with its own payload', () => {
		assert.ok(
			accepts(componentEntryEventSchema, {
				kind: 'CLAIM',
				incurred_on: '2026-04-02',
				description: null
			})
		);
		assert.ok(accepts(componentEntryEventSchema, { kind: 'ALLOWANCE' }));
		assert.ok(accepts(componentEntryEventSchema, { kind: 'BONUS', note: null }));
		assert.ok(
			accepts(componentEntryEventSchema, {
				kind: 'ARREARS',
				covers_periods: ['2026-01'],
				reason: 'late start'
			})
		);
		assert.ok(
			accepts(componentEntryEventSchema, {
				kind: 'MANUAL_ADJUSTMENT',
				operation: 'CORRECTION',
				reason: 'wrong rate'
			})
		);
	});

	// `onExcessProperty: 'error'` is the strict standard view: an arm carrying another arm's payload
	// is refused rather than stripped, which is what made the jsonb-union shape a defect the last
	// time this workspace held money in one.
	it('refuses an unknown key on an arm', () => {
		assert.ok(refuses(componentEntryEventSchema, { kind: 'ALLOWANCE', note: 'x' }));
		assert.ok(
			refuses(componentEntryEventSchema, { kind: 'CLAIM', incurred_on: '2026-04-02', note: 'x' })
		);
	});

	it('refuses an unknown arm', () => {
		assert.ok(refuses(componentEntryEventSchema, { kind: 'REVERSAL' }));
		assert.ok(refuses(componentEntryEventSchema, { kind: 'ENTERED' }));
	});
});

describe('leave_entitlement', () => {
	// The STATUTORY arm this union once carried moved into the statutory profile's
	// `statutory_leave` member; what remains are the company's own layers. The `accrual_key`
	// datatype, the `MAX_WITH_COMPANY_LAYERS` merge marker and the layer `authority` /
	// `effective_range` moved to the containing leave plan: the band sits on the layer itself.
	const layer = {
		level: 'ORGANISATION',
		band_from: 0,
		days: 8
	};
	const entitlement = { layers: [layer] };

	it('accepts a company layer — a flat entitlement is band_from 0', () => {
		assert.ok(accepts(leaveEntitlementSchema, entitlement));
	});

	it('refuses the dropped STATUTORY arm', () => {
		assert.ok(
			refuses(leaveEntitlementSchema, {
				...entitlement,
				layers: [{ ...layer, level: 'STATUTORY' }]
			})
		);
	});

	// `Schema.Number` would accept every one of these; the `z.int().check(z.minimum(0))` it replaced
	// accepted none.
	it('refuses a band that is not a whole non-negative count', () => {
		for (const band_from of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			assert.ok(
				refuses(leaveEntitlementSchema, { ...entitlement, layers: [{ ...layer, band_from }] }),
				`band_from=${String(band_from)}`
			);
		}
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

	it('refuses retired person-specific, merge, key and authority members', () => {
		assert.ok(
			refuses(leaveEntitlementSchema, {
				...entitlement,
				layers: [{ ...layer, level: 'EMPLOYEE', employment_id: 'employment-1' }]
			})
		);
		assert.ok(
			refuses(leaveEntitlementSchema, { ...entitlement, merge: 'MAX_WITH_COMPANY_LAYERS' })
		);
		assert.ok(
			refuses(leaveEntitlementSchema, {
				...entitlement,
				layers: [{ ...layer, key: { by: 'SERVICE_MONTHS', band_from: 0 } }]
			})
		);
		assert.ok(
			refuses(leaveEntitlementSchema, {
				...entitlement,
				layers: [{ ...layer, authority: 'Company policy 2026' }]
			})
		);
		assert.ok(
			refuses(leaveEntitlementSchema, {
				...entitlement,
				layers: [{ ...layer, effective_range: RANGE }]
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

describe('statutory_leave_profile', () => {
	const eventLeave = {
		kind: 'SHARED_PARENTAL',
		account_basis: 'EVENT',
		qualifying_service_months: 3,
		vesting: 'UPFRONT',
		event: { window_months: 12, allocation: 'HOUSEHOLD' },
		ladder: [{ band_from: 0, days: 50 }],
		per_child: null,
		max_days: 50,
		transition: 'NEXT_LEAVE_YEAR',
		settlement: { settlement: 'FORFEIT' },
		authority: 'Fixture statutory source'
	};

	it('accepts event coverage and refuses carry or a missing event window', () => {
		assert.ok(accepts(statutoryLeaveProfileSchema, [eventLeave]));
		assert.ok(
			accepts(statutoryLeaveProfileSchema, [
				{
					...eventLeave,
					event: {
						window_months: 12,
						allocation: 'HOUSEHOLD',
						unit: 'WEEKS',
						weekly_index_cap: 6
					}
				}
			])
		);
		assert.ok(
			refuses(statutoryLeaveProfileSchema, [
				{
					...eventLeave,
					event: { window_months: 12, allocation: 'HOUSEHOLD', unit: 'WEEKS' }
				}
			])
		);
		assert.ok(refuses(statutoryLeaveProfileSchema, [{ ...eventLeave, event: undefined }]));
		assert.ok(
			refuses(statutoryLeaveProfileSchema, [
				{
					...eventLeave,
					settlement: { settlement: 'CARRY', limit_days: 1, expiry_months: 1, coverage: null }
				}
			])
		);
		assert.ok(
			refuses(statutoryLeaveProfileSchema, [
				{ ...eventLeave, settlement: { settlement: 'COMMUTE', pay_basis: 'ORDINARY_DIV26' } }
			])
		);
	});

	it('accepts carry, commute and forfeit settlements on yearly leave', () => {
		const yearly = { ...eventLeave };
		delete yearly.account_basis;
		delete yearly.event;
		for (const settlement of [
			{ settlement: 'FORFEIT' },
			{ settlement: 'CARRY', limit_days: null, expiry_months: 12, coverage: ['SG_PART_IV'] },
			{ settlement: 'COMMUTE', pay_basis: 'MONTHLY_DIV30' }
		]) {
			assert.ok(accepts(statutoryLeaveProfileSchema, [{ ...yearly, settlement }]));
		}
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
			matrix: { merge: 'MAX_WITH_COMPANY_LAYERS', layers: [capLayer] },
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
				cap: { ...entry.cap, matrix: { merge: 'MAX_WITH_COMPANY_LAYERS', layers: [] } }
			})
		);
	});

	it('refuses a percentage outside 0-100 or a non-finite amount', () => {
		const withLayer = (patch: Record<string, unknown>) => ({
			...entry,
			cap: {
				...entry.cap,
				matrix: { merge: 'MAX_WITH_COMPANY_LAYERS', layers: [{ ...capLayer, ...patch }] }
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
