import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPayslipPages } from '../src/lib/ui/payslip-export-pages.ts';

test('one export follows eighteen bounded pages and retains all 89 distinct persisted files', async () => {
	const offsets: number[] = [];
	const progress: number[] = [];
	const files = await collectPayslipPages(
		async (offset) => {
			offsets.push(offset);
			const end = Math.min(89, offset + 5);
			return {
				artefacts: [
					{
						files: Array.from({ length: end - offset }, (_, n) => ({
							id: `file-${offset + n}`,
							name: `payslip-${offset + n}.pdf`
						}))
					}
				],
				next_payslip_offset: end < 89 ? end : null
			};
		},
		(files) => progress.push(files.length)
	);
	assert.deepEqual(
		offsets,
		Array.from({ length: 18 }, (_, n) => n * 5)
	);
	assert.equal(files.length, 89);
	assert.equal(new Set(files.map((file) => file.id)).size, 89);
	assert.equal(progress.at(-1), 89);
});

test('a failed continuation retains earlier evidence and refuses to claim a completed export', async () => {
	let retained = 0;
	await assert.rejects(
		collectPayslipPages(
			async (offset) => {
				if (offset > 0) throw new Error('The next saved run refused.');
				return {
					artefacts: [{ files: [{ id: 'saved', name: 'saved.pdf' }] }],
					next_payslip_offset: 5
				};
			},
			(files) => (retained = files.length)
		),
		/next saved run refused/
	);
	assert.equal(retained, 1);
});

test('a repeated cursor refuses instead of repeatedly exporting employees', async () => {
	await assert.rejects(
		collectPayslipPages(async () => ({ artefacts: [], next_payslip_offset: 0 })),
		/did not advance/
	);
});
