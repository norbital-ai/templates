// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { instantRangeSchema } from '@norbital-ai/bolt/authoring';
import { entitlementCapSchema } from '../src/datatypes/entitlement_cap/+definition.js';
import { contributionTreatmentSchema } from '../src/datatypes/contribution_treatment/+definition.js';
import { allowanceRecurrenceSchema } from '../src/datatypes/allowance_recurrence/+definition.js';
import { leaveEntitlementSchema } from '../src/datatypes/leave_entitlement/+definition.js';
import { contributionTreatmentsSchema } from '../src/datatypes/contribution_treatments/+definition.js';
import { ordinaryRateSchema } from '../src/datatypes/ordinary_rate/+definition.js';
import { rateAwardSchema } from '../src/datatypes/rate_award/+definition.js';
import { rateSelectorSchema } from '../src/datatypes/rate_selector/+definition.js';
import { minimumWagesSchema } from '../src/datatypes/minimum_wages/+definition.js';
import { statutoryRegimeSchema } from '../src/datatypes/statutory_regime/+definition.js';
import { holidaySnapshotsSchema } from '../src/datatypes/holiday_snapshots/+definition.js';
import ContributionBands from '../src/datatypes/contribution_bands/+definition.js';

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
		assert.ok(accepts(allowanceRecurrenceSchema, { kind: 'ONE_OFF', on: '2026-02-15' }));
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
				on: '2026-02-15',
				from: '2026-01-01'
			})
		);
		assert.ok(refuses(allowanceRecurrenceSchema, { kind: 'ONE_OFF', on: '2026-13-01' }));
		assert.ok(refuses(allowanceRecurrenceSchema, { kind: 'MONTHLY', period: '2026-02' }));
	});
});

describe('leave_entitlement', () => {
	const band = { eligibility: '', days: 8 };
	const entitlement = {
		availability: 'UPFRONT',
		year_start_month: 1,
		proration: 'NONE',
		bands: [band]
	};
	it('accepts predicate bands and unlimited leave without a yearly account', () => {
		assert.ok(
			accepts(leaveEntitlementSchema, {
				...entitlement,
				bands: [{ eligibility: 'terms.grade == "M1"', days: 20 }, band]
			})
		);
		assert.ok(accepts(leaveEntitlementSchema, entitlement));
		assert.ok(
			accepts(leaveEntitlementSchema, { ...entitlement, availability: 'UNLIMITED', bands: [] })
		);
	});
	it('refuses a band whose predicate is not a string', () => {
		for (const eligibility of [null, 0, true])
			assert.ok(
				refuses(leaveEntitlementSchema, { ...entitlement, bands: [{ ...band, eligibility }] }),
				`eligibility=${String(eligibility)}`
			);
	});
	it('refuses NaN, Infinity and negative entitlement days', () => {
		for (const days of [Number.NaN, Number.POSITIVE_INFINITY, -1])
			assert.ok(
				refuses(leaveEntitlementSchema, { ...entitlement, bands: [{ ...band, days }] }),
				`days=${String(days)}`
			);
	});
	it('refuses invalid anniversary months', () => {
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
			{ band_from: 0 },
			{ authority: 'Company policy' },
			{ effective_range: RANGE },
			{ days_max: 9 }
		])
			assert.ok(
				refuses(leaveEntitlementSchema, { ...entitlement, bands: [{ ...band, ...extra }] })
			);
	});
});

describe('entitlement_cap', () => {
	const cap = {
		period: 'CALENDAR_YEAR',
		on_exceed: 'BLOCK',
		bands: [
			{ eligibility: 'terms.grade == "G3"', amount: 2000 },
			{ eligibility: '', amount: 500 }
		]
	};

	it('accepts a matrix of bands', () => {
		assert.ok(accepts(entitlementCapSchema, cap));
		assert.ok(accepts(entitlementCapSchema, { ...cap, period: 'PER_EVENT', on_exceed: 'ALLOW' }));
	});

	// An empty matrix is not "no cap" — `null` on the column is. It is a cap nobody is entitled under.
	it('refuses a cap with no bands', () => {
		assert.ok(refuses(entitlementCapSchema, { ...cap, bands: [] }));
	});

	it('refuses a negative or non-finite amount', () => {
		for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY])
			assert.ok(refuses(entitlementCapSchema, { ...cap, bands: [{ eligibility: '', amount }] }));
	});

	it('refuses an unknown period, an unknown overflow rule and an excess key at every depth', () => {
		assert.ok(refuses(entitlementCapSchema, { ...cap, period: 'WEEK' }));
		assert.ok(refuses(entitlementCapSchema, { ...cap, on_exceed: 'WARN' }));
		assert.ok(refuses(entitlementCapSchema, { ...cap, merge: 'MAX_WITH_COMPANY_LAYERS' }));
		assert.ok(
			refuses(entitlementCapSchema, {
				...cap,
				bands: [{ eligibility: '', amount: 1, reimbursement_percentage: 100 }]
			})
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
	const row = (per: string, divisor: unknown, eligibility = '') => ({ eligibility, per, divisor });
	it('accepts the five seeded derivations as one-row ladders, and predicate rows above them', () => {
		for (const rate of [
			row('DAY', 26),
			row('DAY', 30),
			row('DAY', 21.75),
			row('HOUR', 190.66666666666666),
			row('HOUR', 173)
		])
			assert.ok(accepts(ordinaryRateSchema, [rate]), JSON.stringify(rate));
		assert.ok(
			accepts(ordinaryRateSchema, [
				row('DAY', 'WORKING_DAYS', 'terms.basic_salary < 20000'),
				row('DAY', 21.75)
			])
		);
	});

	it('refuses no rows, a divisor that is not positive, finite or WORKING_DAYS, and a missing predicate', () => {
		assert.ok(refuses(ordinaryRateSchema, []));
		assert.ok(refuses(ordinaryRateSchema, [row('DAY', 0)]));
		assert.ok(refuses(ordinaryRateSchema, [row('DAY', -26)]));
		assert.ok(refuses(ordinaryRateSchema, [row('DAY', '26')]));
		assert.ok(refuses(ordinaryRateSchema, [row('DAY', 'CALENDAR_DAYS')]));
		assert.ok(refuses(ordinaryRateSchema, [{ per: 'DAY', divisor: 26 }]));
	});

	it('refuses the single-object shape, the old two-column vocabulary and any other unit', () => {
		assert.ok(refuses(ordinaryRateSchema, { per: 'DAY', divisor: 26 }));
		assert.ok(refuses(ordinaryRateSchema, [row('DAYS_PER_MONTH', 26)]));
		assert.ok(refuses(ordinaryRateSchema, [row('WEEK', 5)]));
		assert.ok(
			refuses(ordinaryRateSchema, [{ ...row('DAY', 26), ordinary_rate_basis: 'DAYS_PER_MONTH' }])
		);
	});
});

describe('contribution_bands, rate_selector and rate_award (P10)', () => {
	const wage = { by: 'WAGE', from: 0, to: null };
	const percent = { kind: 'PERCENT', employee: 11, employer: 13 };
	const bands = ContributionBands.schema;
	it('accepts a band with or without an eligibility predicate, and two same-wage bands with different ones', () => {
		assert.ok(accepts(bands, [{ selector: wage, award: percent }]));
		assert.ok(
			accepts(bands, [
				{ selector: wage, award: percent, eligibility: 'employee.residency_months < 12' },
				{ selector: wage, award: percent, eligibility: 'employee.residency_months >= 12' }
			])
		);
		assert.ok(
			refuses(bands, [
				{ selector: wage, award: percent, eligibility: 'employee.age > 1' },
				{ selector: wage, award: percent, eligibility: 'employee.age > 1' }
			]),
			'the same predicate twice over the same wage is one ladder overlapping itself'
		);
		assert.ok(refuses(bands, [{ selector: wage, award: percent, eligibility: null }]));
	});
	it('no longer knows a WAGE_AND_MARITAL selector', () => {
		assert.ok(
			refuses(rateSelectorSchema, { by: 'WAGE_AND_MARITAL', from: 0, to: null, marital: 'SINGLE' })
		);
		assert.ok(
			accepts(rateSelectorSchema, {
				by: 'WAGE_AND_AGE',
				from: 0,
				to: null,
				age_from: 0,
				age_to: 60
			})
		);
	});
	it('accepts an employer percentage on a PROGRESSIVE award and refuses a negative one or one on PERCENT', () => {
		assert.ok(
			accepts(rateAwardSchema, { kind: 'PROGRESSIVE', rate: 20, constant: 0, employer: 17 })
		);
		assert.ok(accepts(rateAwardSchema, { kind: 'PROGRESSIVE', rate: 20, constant: 0 }));
		assert.ok(
			refuses(rateAwardSchema, { kind: 'PROGRESSIVE', rate: 20, constant: 0, employer: -1 })
		);
		assert.ok(refuses(rateAwardSchema, { kind: 'PERCENT', employee: 1, employer: 1, rate: 1 }));
	});
});

describe('minimum_wages', () => {
	it('accepts region → positive wage and refuses an empty region, a zero wage or a non-number', () => {
		assert.ok(accepts(minimumWagesSchema, { I: 4_960_000, II: 4_500_000 }));
		assert.ok(accepts(minimumWagesSchema, {}));
		assert.ok(refuses(minimumWagesSchema, { '': 1 }));
		assert.ok(refuses(minimumWagesSchema, { I: 0 }));
		assert.ok(refuses(minimumWagesSchema, { I: '4960000' }));
	});
});

describe('statutory_regime (P10)', () => {
	const regime = {
		holiday_rest_precedence: 'SUBSTITUTE',
		overtime_coverage: null,
		overtime_rules: [
			{
				day_type: 'SPECIAL_HOLIDAY',
				band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
				award: { kind: 'HOURLY_MULTIPLE', multiple: 1.3 }
			}
		],
		overtime_limits: [
			{ period: 'QUARTER', measures: 'OVERTIME_HOURS', max_hours: 138, on_exceed: 'BLOCK' },
			{ period: 'YEAR', measures: 'OVERTIME_HOURS', max_hours: 200, on_exceed: 'WARN' }
		],
		night_premium: { from: '22:00', to: '06:00', ordinary_add: 30, overtime_add: 20 }
	};
	it('accepts SUBSTITUTE, SPECIAL_HOLIDAY, QUARTER and YEAR, and a night window; absent or null night is no premium', () => {
		assert.ok(accepts(statutoryRegimeSchema, regime));
		assert.ok(accepts(statutoryRegimeSchema, { ...regime, night_premium: null }));
		const { night_premium: _none, ...without } = regime;
		assert.ok(accepts(statutoryRegimeSchema, without));
	});
	it('refuses a night window that is not wall-clock time, or a negative premium', () => {
		assert.ok(
			refuses(statutoryRegimeSchema, {
				...regime,
				night_premium: { ...regime.night_premium, from: '22' }
			})
		);
		assert.ok(
			refuses(statutoryRegimeSchema, {
				...regime,
				night_premium: { ...regime.night_premium, to: '25:00' }
			})
		);
		assert.ok(
			refuses(statutoryRegimeSchema, {
				...regime,
				night_premium: { ...regime.night_premium, ordinary_add: -1 }
			})
		);
		assert.ok(
			refuses(statutoryRegimeSchema, { ...regime, night_premium: { from: '22:00', to: '06:00' } })
		);
	});
});

describe('holiday_snapshots', () => {
	const snapshot = {
		id: '0d3f1c2e-6b1a-4f0e-9a1b-000000000001',
		company_id: '11111111-1111-4111-8111-111111111111',
		date: '2026-08-21',
		name: 'Ninoy Aquino Day',
		kind: 'SPECIAL',
		original_date: null,
		published_at: '2026-01-01T00:00:00.000Z'
	};
	it('carries the kind and refuses one it does not know or a snapshot without it', () => {
		assert.ok(accepts(holidaySnapshotsSchema, [snapshot]));
		assert.ok(refuses(holidaySnapshotsSchema, [{ ...snapshot, kind: 'REGULAR' }]));
		const { kind: _kind, ...without } = snapshot;
		assert.ok(refuses(holidaySnapshotsSchema, [without]));
	});
});
