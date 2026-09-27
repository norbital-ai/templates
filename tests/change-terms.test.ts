// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** The change-terms pair: the row in force closes the day before its successor, through the terms amendment rule. */
import assert from 'node:assert/strict';
import test from 'node:test';
import terms from '../src/data/collection/employment_terms/+collection.ts';
import {
	buildChangeTermsWrites,
	previousDay
} from '../src/lib/ui/offboarding/change-terms-submit.ts';
import { transform } from './helpers/bodies.ts';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const previous = {
	id: id(4),
	employment_id: id(1),
	job_title: null,
	employment_type: 'PERMANENT',
	allowances: [],
	effective_range: { from: '2025-01-01', to: null }
};
/** A work day on `day` consumed the contract's terms through it; `null` consumes nothing. */
const consumed = (day) => ({
	employments: [{ id: id(1), effective_range: { from: '2025-01-01', to: null } }],
	work_days: day == null ? [] : [{ employment_id: id(1), work_date: day }]
});

test('change-terms closes the previous row the day before through the transform’s amendment rule', async () => {
	assert.equal(previousDay('2026-07-01'), '2026-06-30');
	assert.equal(previousDay('2026-03-01'), '2026-02-28');
	const { close, create } = buildChangeTermsWrites({
		previousId: id(4),
		employmentId: id(1),
		previousStart: '2025-01-01',
		closeEnd: '2026-06-30',
		newStart: '2026-07-01',
		facts: {
			residency_status: null,
			residency_since: null,
			currency: 'MYR',
			base_salary: 3500,
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
			department: null,
			job_title: null,
			payroll_group: null,
			paid_rest_days: false,
			grade: 'G3',
			shift_pattern_id: id(5)
		}
	});
	assert.deepEqual(close, {
		target: id(4),
		set: { effective_range: { from: '2025-01-01', to: '2026-06-30' } }
	});
	assert.equal(create.employment_id, id(1));
	assert.equal('id' in create, false, 'the successor carries no id; the runtime assigns it');
	assert.deepEqual(create.effective_range, { from: '2026-07-01', to: null });
	// The successor starts the day after the predecessor closes: no gap, no overlap, the tail open.
	assert.equal(previousDay(create.effective_range.from), close.set.effective_range.to);
	// Both halves pass the amendment rule while nothing is consumed …
	await transform(terms, [close.set], { existing: [previous], tables: consumed(null) });
	await transform(terms, [create], { tables: consumed('2026-01-05') });
	// … and the close is refused once it would uncover consumed dates.
	await assert.rejects(
		transform(terms, [close.set], { existing: [previous], tables: consumed('2026-08-01') }),
		/consumed/
	);
	assert.throws(
		() =>
			buildChangeTermsWrites({
				previousId: id(4),
				employmentId: id(1),
				previousStart: '2025-01-01',
				closeEnd: '2026-06-29',
				newStart: '2026-07-01',
				facts: create
			}),
		/day after/
	);
});
