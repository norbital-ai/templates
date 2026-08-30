// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectStatutoryDrift } from '../automations/+statutory_profile_drift.ts';
import { coversDate } from '../collections/payroll_runs/lib/effective.ts';

const today = '2026-08-14';
const open = { start: '2020-01-01T00:00:00.000Z', end: null };
const oldRange = { start: '2020-01-01T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' };
const newRange = { start: '2026-01-01T00:00:00.000Z', end: null };

const my = {
	id: 'j-new',
	code: 'MY',
	name: 'Malaysia 2026',
	lifecycle: 'SEALED',
	effective_range: newRange
};
const myOld = {
	id: 'j-old',
	code: 'MY',
	name: 'Malaysia 2020',
	lifecycle: 'SEALED',
	effective_range: oldRange
};
// `jurisdiction_id` is the law-family anchor a copy-on-write successor keeps; only
// `statutory_profile_id` moves between versions.
const epf = {
	id: 's-epf-new',
	jurisdiction_id: 'j-family',
	statutory_profile_id: 'j-new',
	code: 'EPF',
	name: 'Employees Provident Fund'
};
const epfOld = {
	id: 's-epf-old',
	jurisdiction_id: 'j-family',
	statutory_profile_id: 'j-old',
	code: 'EPF',
	name: 'Employees Provident Fund'
};

describe('coversDate', () => {
	it('treats an open end as covering today', () => {
		assert.equal(coversDate(open, today), true);
		assert.equal(coversDate(oldRange, today), false);
		assert.equal(coversDate(newRange, today), true);
	});
});

describe('detectStatutoryDrift', () => {
	it('flags a company still anchored to a superseded profile version', () => {
		const result = detectStatutoryDrift({
			governingProfiles: [my],
			profileSchemes: [epf],
			profileRates: [
				{
					id: 'r1',
					statutory_contribution_id: 's-epf-new',
					summary: '0 – ∞'
				}
			],
			companies: [
				{
					id: 'c1',
					name: 'Acme Sdn Bhd',
					jurisdiction: myOld
				}
			],
			employments: [],
			facts: []
		});
		assert.equal(result.items[0]?.kind, 'superseded_company_jurisdiction');
		assert.match(result.items[0]?.label ?? '', /Acme Sdn Bhd/);
	});

	it('plans a unique successor copy onto the governing profile and skips an ambiguous one', () => {
		const unique = detectStatutoryDrift({
			governingProfiles: [my],
			profileSchemes: [epf],
			profileRates: [
				{
					id: 'r1',
					statutory_contribution_id: 's-epf-new',
					summary: '0 – ∞'
				}
			],
			companies: [],
			employments: [],
			facts: [
				{
					id: 'f1',
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
			governingProfiles: [my],
			profileSchemes: [
				epf,
				{
					id: 's-epf-also',
					jurisdiction_id: 'j-family',
					statutory_profile_id: 'j-new',
					code: 'EPF',
					name: 'EPF other'
				}
			],
			profileRates: [],
			companies: [],
			employments: [],
			facts: [
				{
					id: 'f1',
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

	it('flags a missing fact and a bandless scheme of the governing profile', () => {
		const result = detectStatutoryDrift({
			governingProfiles: [my],
			profileSchemes: [epf],
			profileRates: [],
			companies: [
				{
					id: 'c1',
					name: 'Acme',
					jurisdiction: my
				}
			],
			employments: [{ id: 'e1', employee_number: 'A-01', company_id: 'c1' }],
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
