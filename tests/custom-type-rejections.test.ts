// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { instantRangeSchema } from '@norbital-ai/bolt/authoring';
import { componentDefinitionSchema } from '../src/datatypes/component_definition/+definition.js';
import { contributionTreatmentSchema } from '../src/datatypes/contribution_treatment/+definition.js';
import { allowanceRecurrenceSchema } from '../src/datatypes/allowance_recurrence/+definition.js';
import { coveredPeriodsSchema } from '../src/datatypes/covered_periods/+definition.js';
import { leaveEntitlementSchema } from '../src/datatypes/leave_entitlement/+definition.js';
import { contributionTreatmentsSchema } from '../src/datatypes/contribution_treatments/+definition.js';
import { ordinaryRateSchema } from '../src/datatypes/ordinary_rate/+definition.js';
import { componentPolicySchema } from '../src/datatypes/component_policy/+definition.js';

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

describe('allowance_recurrence', () => {
	// The one payload that stayed a union when `component_entry_event` was split into five
	// collections, because it is a genuine two-armed fact about a single family rather than five
	// business facts wearing one type. What it does NOT carry is still the point: no employment, no
	// component, no amount — those are columns, because a foreign key and a field grant cannot
	// reach inside a blob.
	it('accepts a one-off period and an open or closed window', () => {
		assert.ok(accepts(allowanceRecurrenceSchema, { kind: 'ONE_OFF', period: '2026-02' }));
		assert.ok(
			accepts(allowanceRecurrenceSchema, { kind: 'RECURRING', from: '2026-01-01', to: null })
		);
		assert.ok(
			accepts(allowanceRecurrenceSchema, {
				kind: 'RECURRING',
				from: '2026-01-01',
				to: '2026-03-31'
			})
		);
	});

	// `onExcessProperty: 'error'` is the strict standard view: an arm carrying the other arm's
	// payload is refused rather than stripped. A one-off that also stated a window would be a row
	// whose two halves could disagree about how many times it pays.
	it('refuses a bare arm, a mixed arm and an unknown one', () => {
		assert.ok(refuses(allowanceRecurrenceSchema, { kind: 'ONE_OFF' }));
		assert.ok(refuses(allowanceRecurrenceSchema, { kind: 'RECURRING', to: null }));
		assert.ok(
			refuses(allowanceRecurrenceSchema, {
				kind: 'ONE_OFF',
				period: '2026-02',
				from: '2026-01-01'
			})
		);
		assert.ok(refuses(allowanceRecurrenceSchema, { kind: 'ONE_OFF', period: '2026-13' }));
		assert.ok(refuses(allowanceRecurrenceSchema, { kind: 'MONTHLY', period: '2026-02' }));
	});
});

describe('covered_periods', () => {
	it('accepts optional historical months and rejects malformed month values', () => {
		assert.ok(accepts(coveredPeriodsSchema, []));
		assert.ok(accepts(coveredPeriodsSchema, ['2026-01']));
		assert.ok(accepts(coveredPeriodsSchema, ['2025-11', '2025-12', '2026-01']));
		assert.ok(refuses(coveredPeriodsSchema, ['2026-1']));
		assert.ok(refuses(coveredPeriodsSchema, ['2026-13']));
		assert.ok(refuses(coveredPeriodsSchema, ['2026-01-15']));
	});
});

describe('leave_entitlement', () => {
	const band = { band_from: 0, days: 8 };
	const entitlement = {
		availability: 'UPFRONT',
		year_start_month: 1,
		proration: 'NONE',
		bands: [band]
	};
	it('accepts service bands and unlimited leave without a yearly account', () => {
		assert.ok(accepts(leaveEntitlementSchema, entitlement));
		assert.ok(
			accepts(leaveEntitlementSchema, { ...entitlement, availability: 'UNLIMITED', bands: [] })
		);
	});
	it('refuses a band threshold that is not a whole non-negative count', () => {
		for (const band_from of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
			assert.ok(
				refuses(leaveEntitlementSchema, { ...entitlement, bands: [{ ...band, band_from }] }),
				`band_from=${String(band_from)}`
			);
	});
	it('refuses NaN, Infinity and negative entitlement days', () => {
		for (const days of [Number.NaN, Number.POSITIVE_INFINITY, -1])
			assert.ok(
				refuses(leaveEntitlementSchema, { ...entitlement, bands: [{ ...band, days }] }),
				`days=${String(days)}`
			);
	});
	it('refuses duplicate service thresholds and invalid anniversary months', () => {
		assert.ok(refuses(leaveEntitlementSchema, { ...entitlement, bands: [band, band] }));
		for (const year_start_month of [0, 13, 1.5])
			assert.ok(refuses(leaveEntitlementSchema, { ...entitlement, year_start_month }));
	});
	it('monthly release requires an earning basis', () => {
		assert.ok(refuses(leaveEntitlementSchema, { ...entitlement, availability: 'MONTHLY' }));
		assert.ok(
			accepts(leaveEntitlementSchema, {
				...entitlement,
				availability: 'MONTHLY',
				proration: 'CALENDAR_MONTHS'
			})
		);
	});
	it('refuses retired layers, personal overrides and undeclared fields', () => {
		for (const extra of [{ layers: [band] }, { merge: 'MAX_WITH_COMPANY_LAYERS' }, { cap: null }])
			assert.ok(refuses(leaveEntitlementSchema, { ...entitlement, ...extra }));
		for (const extra of [
			{ level: 'EMPLOYEE', employment_id: 'employment-1' },
			{ key: { by: 'SERVICE_MONTHS' } },
			{ authority: 'Company policy' },
			{ effective_range: RANGE },
			{ days_max: 9 }
		])
			assert.ok(
				refuses(leaveEntitlementSchema, { ...entitlement, bands: [{ ...band, ...extra }] })
			);
	});
});

describe('component_policy', () => {
	const policy = { kind: 'EARNING', settlement: 'ADD' };

	it('accepts an earning that adds', () => {
		assert.ok(accepts(componentPolicySchema, policy));
	});

	// The arms differ only in two literals, so a settlement belonging to another arm must fail rather
	// than be accepted: a component stored settling in a direction nobody declared changes net pay.
	it('refuses a kind and settlement that do not belong together', () => {
		assert.ok(refuses(componentPolicySchema, { ...policy, settlement: 'DEDUCT' }));
		assert.ok(refuses(componentPolicySchema, { ...policy, kind: 'PENALTY' }));
	});

	// Chargeability moved to `contribution_treatments`; a policy still carrying the old list is a
	// row written against the previous shape and must be reported, not silently narrowed.
	it('refuses the statutory treatments the policy no longer carries', () => {
		assert.ok(refuses(componentPolicySchema, { ...policy, statutory_treatments: [] }));
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
		eligibility: '',
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

describe('contribution_treatments', () => {
	it('accepts a map of scheme code to treatment, including a special rule', () => {
		assert.ok(
			accepts(contributionTreatmentsSchema, {
				EPF: { kind: 'EXCLUDE' },
				SOCSO: { kind: 'INCLUDE' },
				PCB: { kind: 'SPECIAL', rule: 'BONUS_SPREAD' }
			})
		);
	});

	/*
	 * An empty map is a component nobody has decided for any scheme, and it has to survive the
	 * schema so that VALIDATE can name the component and the scheme and refuse the run. Refusing it
	 * here would move a payroll fault into a write error on an unrelated edit.
	 */
	it('accepts an empty map, which VALIDATE and ACCUMULATE refuse rather than the schema', () => {
		assert.ok(accepts(contributionTreatmentsSchema, {}));
	});

	it('refuses an empty scheme code', () => {
		assert.ok(refuses(contributionTreatmentsSchema, { '': { kind: 'INCLUDE' } }));
	});

	it('refuses a cell the treatment schema would refuse on its own', () => {
		assert.ok(refuses(contributionTreatmentsSchema, { EPF: { kind: 'NONE' } }));
		assert.ok(refuses(contributionTreatmentsSchema, { EPF: { kind: 'SPECIAL', rule: '' } }));
	});

	it('refuses the dated, cited entry shape the old schedule carried', () => {
		assert.ok(
			refuses(contributionTreatmentsSchema, {
				EPF: { kind: 'EXCLUDE', authority: 'EPF Act 1991 s.2', effective_range: RANGE }
			})
		);
	});
});

describe('ordinary_rate', () => {
	it('accepts the five seeded derivations', () => {
		for (const rate of [
			{ per: 'DAY', divisor: 26 },
			{ per: 'DAY', divisor: 30 },
			{ per: 'DAY', divisor: 21.75 },
			{ per: 'HOUR', divisor: 190.66666666666666 },
			{ per: 'HOUR', divisor: 173 }
		])
			assert.ok(accepts(ordinaryRateSchema, rate), JSON.stringify(rate));
	});

	it('refuses a divisor that is not a positive finite number', () => {
		assert.ok(refuses(ordinaryRateSchema, { per: 'DAY', divisor: 0 }));
		assert.ok(refuses(ordinaryRateSchema, { per: 'DAY', divisor: -26 }));
		assert.ok(refuses(ordinaryRateSchema, { per: 'DAY', divisor: '26' }));
		assert.ok(refuses(ordinaryRateSchema, { per: 'DAY' }));
	});

	it('refuses the old two-column vocabulary and any other unit', () => {
		assert.ok(refuses(ordinaryRateSchema, { per: 'DAYS_PER_MONTH', divisor: 26 }));
		assert.ok(refuses(ordinaryRateSchema, { per: 'WEEK', divisor: 5 }));
		assert.ok(
			refuses(ordinaryRateSchema, {
				per: 'DAY',
				divisor: 26,
				ordinary_rate_basis: 'DAYS_PER_MONTH'
			})
		);
	});
});
