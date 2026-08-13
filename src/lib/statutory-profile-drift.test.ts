// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coversDate, detectStatutoryDrift } from '../automation/+statutory_profile_drift.ts';

const today = '2026-08-14';
const open = { start: '2020-01-01T00:00:00.000Z', end: null };
const oldRange = { start: '2020-01-01T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' };
const newRange = { start: '2026-01-01T00:00:00.000Z', end: null };

const my = {
	norbital_id: 'j-new',
	code: 'MY',
	name: 'Malaysia 2026',
	effective_range: newRange
};
const myOld = {
	norbital_id: 'j-old',
	code: 'MY',
	name: 'Malaysia 2020',
	effective_range: oldRange
};
const epf = {
	norbital_id: 's-epf-new',
	jurisdiction_id: 'j-new',
	code: 'EPF',
	name: 'Employees Provident Fund',
	effective_range: newRange
};
const epfOld = {
	norbital_id: 's-epf-old',
	jurisdiction_id: 'j-old',
	code: 'EPF',
	name: 'Employees Provident Fund',
	effective_range: oldRange
};

describe('coversDate', () => {
	it('treats an open end as covering today', () => {
		assert.equal(coversDate(open, today), true);
		assert.equal(coversDate(oldRange, today), false);
		assert.equal(coversDate(newRange, today), true);
	});
});

describe('detectStatutoryDrift', () => {
	it('flags a company still bound to a superseded jurisdiction snapshot', () => {
		const result = detectStatutoryDrift({
			today,
			inForceJurisdictions: [my],
			inForceSchemes: [epf],
			inForceRates: [
				{
					norbital_id: 'r1',
					statutory_contribution_id: 's-epf-new',
					summary: '0 – ∞',
					effective_range: newRange
				}
			],
			companies: [
				{
					norbital_id: 'c1',
					name: 'Acme Sdn Bhd',
					jurisdiction_id: 'j-old',
					jurisdiction: myOld
				}
			],
			employments: [],
			facts: []
		});
		assert.equal(result.items[0]?.kind, 'superseded_company_jurisdiction');
		assert.match(result.items[0]?.label ?? '', /Acme Sdn Bhd/);
	});

	it('plans a unique successor copy and skips an ambiguous one', () => {
		const unique = detectStatutoryDrift({
			today,
			inForceJurisdictions: [my],
			inForceSchemes: [{ ...epf, jurisdiction_id: 'j-old' }],
			inForceRates: [
				{
					norbital_id: 'r1',
					statutory_contribution_id: 's-epf-new',
					summary: '0 – ∞',
					effective_range: newRange
				}
			],
			companies: [],
			employments: [],
			facts: [
				{
					norbital_id: 'f1',
					employment_id: 'e1',
					statutory_contribution_id: 's-epf-old',
					status: { kind: 'REGISTERED', reference_number: 'E-1' },
					summary: 'Registered · E-1',
					effective_range: open,
					scheme: epfOld
				}
			]
		});
		assert.equal(unique.copies.length, 1);
		assert.equal(unique.copies[0]?.successorSchemeId, 's-epf-new');

		const ambiguous = detectStatutoryDrift({
			today,
			inForceJurisdictions: [my],
			inForceSchemes: [
				{ ...epf, jurisdiction_id: 'j-old' },
				{
					norbital_id: 's-epf-also',
					jurisdiction_id: 'j-old',
					code: 'EPF',
					name: 'EPF other',
					effective_range: newRange
				}
			],
			inForceRates: [],
			companies: [],
			employments: [],
			facts: [
				{
					norbital_id: 'f1',
					employment_id: 'e1',
					statutory_contribution_id: 's-epf-old',
					status: { kind: 'REGISTERED' },
					summary: 'Registered',
					effective_range: open,
					scheme: epfOld
				}
			]
		});
		assert.equal(ambiguous.copies.length, 0);
		assert.equal(
			ambiguous.items.some((item) => /ambiguous/.test(item.label)),
			true
		);
	});

	it('flags a missing fact and a scheme with no rate covering today', () => {
		const result = detectStatutoryDrift({
			today,
			inForceJurisdictions: [my],
			inForceSchemes: [epf],
			inForceRates: [],
			companies: [
				{
					norbital_id: 'c1',
					name: 'Acme',
					jurisdiction_id: 'j-new',
					jurisdiction: my
				}
			],
			employments: [{ norbital_id: 'e1', employee_number: 'A-01', company_id: 'c1' }],
			facts: []
		});
		assert.equal(
			result.items.some((item) => item.kind === 'missing_fact'),
			true
		);
		assert.equal(
			result.items.some((item) => item.kind === 'rate_gap'),
			true
		);
	});
});
