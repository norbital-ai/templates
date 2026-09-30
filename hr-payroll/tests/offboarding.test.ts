// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Off-boarding a fixed-term contract: an end not yet passed may move earlier (an early departure), never later, never
 * away; a passed end never moves. The helper clock's today is 2026-06-15.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import employments from '../src/data/collection/employments/+collection.ts';
import { transform } from './helpers/bodies.ts';

const contract = (from, to) => ({
	id: 'a',
	employee_id: 'person',
	company_id: 'entity',
	employee_number: 'E1',
	effective_range: { from, to },
	exit_ground: null,
	exit_facts: null,
	comments: null
});
// The OPS SG shape: a referenced contract set to end 2030-12-31.
const fixedTerm = contract('2025-01-01', '2030-12-31');
const leave = (row, to, over = {}) =>
	transform(
		employments,
		[
			{
				effective_range: { from: row.effective_range.from, to },
				exit_ground: 'RESIGNATION',
				...over
			}
		],
		{
			existing: [row],
			tables: {
				employments: [row],
				employment_terms: [{ employment_id: 'a', approval_id: null }],
				// A departure ground is a code of the sealed version's TERMINATION_GROUND table (exit_ground sweep).
				companies: [{ id: 'entity', settings_code: 'X' }],
				jurisdiction_settings: [
					{
						id: 'x',
						code: 'X',
						sealed_at: '2025-01-01T00:00:00.000Z',
						voided_at: null,
						approval_id: null,
						effective_range: { from: '2025-01-01', to: null },
						exit_facts: []
					}
				],
				reference_rows: [
					{
						settings_id: 'x',
						table: 'TERMINATION_GROUND',
						code: 'RESIGNATION',
						effective_range: { from: '2025-01-01', to: null }
					}
				]
			}
		}
	);

test('a future end moves earlier on departure, to a later or an earlier day than today', async () => {
	await leave(fixedTerm, '2026-06-30');
	await leave(fixedTerm, '2026-05-31');
	// an end of today has not passed
	await leave(contract('2025-01-01', '2026-06-15'), '2026-06-10');
});

test('a set end never extends or reopens, a start never moves, and a passed end never moves', async () => {
	await assert.rejects(leave(fixedTerm, '2031-12-31'), /cannot be reopened or extended/);
	// Without a last day there is no departure to ground: the reopening itself is refused.
	await assert.rejects(
		leave(fixedTerm, null, { exit_ground: null }),
		/cannot be reopened or extended/
	);
	await assert.rejects(
		leave(fixedTerm, '2026-06-30', { effective_range: { from: '2025-02-01', to: '2026-06-30' } }),
		/cannot be reopened or extended/
	);
	await assert.rejects(
		leave(contract('2025-01-01', '2026-03-31'), '2026-02-28'),
		/cannot be reopened or extended/
	);
});
