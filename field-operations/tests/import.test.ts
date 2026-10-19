import { present } from './test-runtime.js';
import { Schema, Effect, Context } from 'effect';
import { Callables } from '@norbital-ai/bolt/engine';
/**
 * The work-order sheet import (L-TPL-field-operations-017): the sample xlsx files its jobs once, one new site per
 * address the workspace lacks; a second import files nothing; new work at a filed address lands on that site; a bad
 * sheet is refused whole, naming each faulty row.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from '@effect/vitest';
import { zipSync } from 'fflate';
import { csvRecords } from '../src/lib/csv.ts';
import { xlsxRecords } from '../src/lib/xlsx.ts';
import { decodeWorkOrders } from '../src/lib/work-order-sheet.ts';
import { CONTROLLER, rows, workspace } from './kit.ts';
it.live('imports the sample xlsx once, filing a site for every address the workspace lacks', () =>
	Effect.gen(function* () {
		const bytes = readFileSync('tests/fixtures/job-import.xlsx');
		const sheet = yield* xlsxRecords(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
		);
		expect(sheet[0]).toEqual({
			site: 'Blk 412 Tampines Street 41 #07-221',
			postal_code: '520412',
			scheduled_for: '46307',
			title: 'Survey — Blk 412 Tampines St 41',
			nature: 'Survey',
			description: 'Site survey for window grille replacement.',
			external_ref: 'IMP-1001'
		});
		const decoded = yield* decodeWorkOrders(sheet);
		const t = yield* workspace();
		const as = t.as(t.member(CONTROLLER));
		const count = Effect.fnUntraced(function* (c: string) {
			return Number(present((yield* rows(t, `SELECT count(*)::int AS n FROM ${c}`))[0]).n);
		});
		expect(yield* as.act('job_assignments.import_work_orders', { rows: decoded })).toMatchObject({
			kind: 'committed',
			output: { created: 5, sites: 4, skipped: 0 }
		});
		expect([yield* count('sites'), yield* count('job_assignments')]).toEqual([4, 5]);
		const [survey, install] = yield* rows(
			t,
			`SELECT site_id, scheduled_for::text AS day, status FROM job_assignments WHERE external_ref IN ('IMP-1001', 'IMP-1002') ORDER BY external_ref`
		);
		expect(survey).toMatchObject({ day: '2026-10-12', status: 'unassigned' });
		expect(present(install).site_id).toBe(present(survey).site_id);
		t.count.reset();
		expect(yield* as.act('job_assignments.import_work_orders', { rows: decoded })).toMatchObject({
			output: { created: 0, skipped: 5 }
		});
		expect(t.count.reads).toBe(1);
		yield* as.act('job_assignments.import_work_orders', {
			rows: yield* decodeWorkOrders(
				csvRecords(
					'site,postal_code,scheduled_for,title\nBlk 412 Tampines St 41 #07-221,520412,2026-10-26,Defect rectification'
				)
			)
		});
		expect(yield* count('sites')).toBe(4);
		const [linked] = yield* rows(
			t,
			`SELECT site_id FROM job_assignments WHERE title = 'Defect rectification'`
		);
		expect(present(linked).site_id).toBe(present(survey).site_id);
		const invalidRows = [
			{ site: '1 Nowhere Rd', scheduled_for: '2026-13-40', title: 'A' },
			{ site: '1 Nowhere Rd', scheduled_for: '2026-10-01', title: 'B', assignee_user_id: 'bob' }
		];
		const bad = yield* Effect.flip(decodeWorkOrders(invalidRows));
		expect(bad).toMatchObject({ _tag: 'SheetInvalid' });
		expect(bad.message).toMatch(/Row 1: .*calendar day/);
		const badUser = yield* Effect.flip(
			decodeWorkOrders([
				{ site: '1 Nowhere Rd', scheduled_for: '2026-10-01', title: 'B', assignee_user_id: 'bob' }
			])
		);
		expect(badUser.message).toMatch(/id|sys_user/);
		const raw = yield* Context.get(t.services, Callables).action({
			collection: 'job_assignments',
			action: 'import_work_orders',
			input: { rows: invalidRows },
			key: 'invalid-sheet',
			invocationId: 'invalid-sheet',
			issuedAt: t.clock.now(),
			authority: as.authority,
			from: 'Client',
			bindings: { now: t.clock.now(), today: '2026-09-25', tz: 'Asia/Singapore', params: {} }
		});
		expect(raw.outcome).toMatchObject({ kind: 'refused' });
		if (raw.outcome.kind !== 'refused') throw new Error('Invalid raw sheet committed');
		expect(raw.outcome.message).toBe(
			'rows.0.scheduled_for: expected a date (YYYY-MM-DD); rows.1.assignee_user_id: expected an id'
		);
		expect(raw.outcome.message).toContain('rows.0.scheduled_for');
		expect(raw.outcome.message).toContain('rows.1.assignee_user_id');
		expect([yield* count('sites'), yield* count('job_assignments')]).toEqual([4, 6]);
	})
);
it.live('keeps the public workbook refusal messages for invalid ZIP and no worksheet', () =>
	Effect.gen(function* () {
		yield* Effect.tryPromise({
			try: () =>
				expect(Effect.runPromise(xlsxRecords(new Uint8Array([1, 2, 3]).buffer))).rejects.toThrow(
					'This file is not an xlsx workbook.'
				),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		});
		const empty = zipSync({});
		yield* Effect.tryPromise({
			try: () =>
				expect(
					Effect.runPromise(
						xlsxRecords(empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength))
					)
				).rejects.toThrow('This workbook has no worksheet.'),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		});
	})
);
it('imports bare-CR CSV rows with the same normalized header and cell contract', () => {
	expect(csvRecords('\ufeffSite,TITLE\r A,Install\r')).toEqual([{ site: 'A', title: 'Install' }]);
});
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
