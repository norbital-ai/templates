/**
 * An acknowledgement belongs to what it acknowledges.
 *
 * In the transcript Bob answers each photo group with "Ok thanks". Filed on the next report's
 * assignment, six of them stacked on 18 Lorong Pisang Udang's conversation as if about that job.
 *
 * Checked only when NORBITAL_SEED_BANK_ROOT points at the private bank.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bankRoot = (process.env.NORBITAL_SEED_BANK_ROOT ?? '').trim();
const bank = resolve(bankRoot, 'field-operations');
const read = (file: string) => JSON.parse(readFileSync(resolve(bank, file), 'utf8'));

test(
	'private bank: every acknowledgement sits on the assignment of the photo it answers',
	{ skip: bankRoot.length === 0 || !existsSync(bank) },
	() => {
		const simulation: { photos: { fileName: string; jobIndex: number; sentAt: string }[] } =
			read('simulation.json');
		const assignments: { id: string }[] = read('job_assignments.json');
		const logs: { job_assignment_id: string; message: string; sender: string; sent_at: string }[] =
			read('communication_logs.json');
		const acknowledgements = logs.filter((row) => row.message === 'Ok thanks');
		assert.ok(acknowledgements.length > 0);
		for (const row of acknowledgements) {
			const answered = simulation.photos
				.filter((photo) => photo.sentAt < row.sent_at)
				.reduce((latest, photo) => (photo.sentAt > latest.sentAt ? photo : latest));
			assert.equal(
				row.job_assignment_id,
				assignments[answered.jobIndex].id,
				`${row.sender} ${row.sent_at} answers ${answered.fileName}`
			);
		}
	}
);
