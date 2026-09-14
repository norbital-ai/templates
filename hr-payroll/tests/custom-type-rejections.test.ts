// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { instantRangeSchema } from '@norbital-ai/bolt/authoring';
import { allowanceRecurrenceSchema } from '../src/datatypes/allowance_recurrence/+definition.js';
import { leaveEntitlementSchema } from '../src/datatypes/leave_entitlement/+definition.js';
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
	it('monthly allowances and earned annual releases are both supported', () => {
		assert.ok(accepts(leaveEntitlementSchema, { ...entitlement, availability: 'MONTHLY' }));
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

describe('contribution_bands (P10)', () => {
	const bands = ContributionBands.schema;
	it('accepts band expressions and refuses a malformed one at write time', () => {
		assert.ok(
			accepts(bands, [
				{
					when: 'base <= 5000.0',
					employee: 'base * 11.0 / 100.0',
					employer: 'base * 13.0 / 100.0'
				},
				{ when: 'base > 5000.0', employee: 'base * 12.0 / 100.0', employer: 'base * 13.0 / 100.0' }
			])
		);
		assert.ok(
			refuses(bands, [{ when: 'bsae <= 5000.0', employee: '0.0', employer: '0.0' }]),
			'an unknown member is refused, not discovered at payroll'
		);
		assert.ok(
			refuses(bands, [
				{ when: 'base <= 5000.0', employee: 'base * 11.0 / 100.0', employer: 'nope' }
			])
		);
		assert.ok(
			refuses(bands, [{ when: 'base <= 5000.0', employee: 'true', employer: '0.0' }]),
			'money is a number'
		);
		assert.ok(refuses(bands, [{ when: '', employee: '0.0', employer: '0.0' }]));
		assert.ok(
			refuses(bands, [{ when: '1.0', employee: '0.0', employer: '0.0' }]),
			'a condition must produce a boolean'
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
		given_to: 'EVERYONE',
		published_at: '2026-01-01T00:00:00.000Z'
	};
	it('carries the kind and refuses one it does not know or a snapshot without it', () => {
		assert.ok(accepts(holidaySnapshotsSchema, [snapshot]));
		assert.ok(refuses(holidaySnapshotsSchema, [{ ...snapshot, kind: 'REGULAR' }]));
		const { kind: _kind, ...without } = snapshot;
		assert.ok(refuses(holidaySnapshotsSchema, [without]));
	});
});
