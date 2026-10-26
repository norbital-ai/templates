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
import { completedRun, CONTRACTOR, CONTROLLER, person, rows, workspace } from './kit.ts';
it.live('imports the sample xlsx once, filing a site for every address the workspace lacks', () =>
	Effect.gen(function* () {
		const bytes = readFileSync('tests/fixtures/job-import.xlsx');
		const sheet = yield* xlsxRecords(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
		);
		expect(sheet[0]).toEqual({
			site: 'Blk 412 Tampines Street 41',
			postal_code: '520412',
			unit_number: '#07-221',
			latitude: '1.3572',
			longitude: '103.9466',
			scheduled_for: '46307',
			title: 'Survey — Blk 412 Tampines St 41',
			nature: 'Survey',
			description: 'Site survey for window grille replacement.',
			external_ref: 'IMP-1001'
		});
		const decoded = yield* decodeWorkOrders(sheet);
		expect(decoded[0]).toMatchObject({ latitude: 1.3572, longitude: 103.9466 });
		const t = yield* workspace();
		const as = t.as(t.member(CONTROLLER));
		const count = Effect.fnUntraced(function* (c: string) {
			return Number(present((yield* rows(t, `SELECT count(*)::int AS n FROM ${c}`))[0]).n);
		});
		const started = yield* as.start('job_assignments_import_work_orders', { rows: decoded });
		expect(started.kind).toBe('committed');
		if (started.kind !== 'committed') throw new Error('The sheet import did not start.');
		expect(yield* rows(t, 'SELECT state FROM sys_run WHERE id = $1', [started.output.id])).toEqual([
			{ state: 'queued' }
		]);
		expect(yield* completedRun(t, started.output.id)).toMatchObject({
			state: 'succeeded',
			error: null,
			output: { created: 5, sites: 4, skipped: 0 }
		});
		expect([yield* count('sites'), yield* count('job_assignments')]).toEqual([4, 5]);
		expect(
			present(
				(yield* as.query('sites', { where: { site_key: { eq: '520412#07-221' } }, all: true }))
					.rows[0]
			)
		).toMatchObject({
			address: 'Blk 412 Tampines Street 41, Singapore 520412',
			unit_number: '#07-221',
			location: { lat: 1.3572, lng: 103.9466 }
		});
		const [survey, install] = yield* rows(
			t,
			`SELECT site_id, scheduled_for::text AS day, status FROM job_assignments WHERE external_ref IN ('IMP-1001', 'IMP-1002') ORDER BY external_ref`
		);
		expect(survey).toMatchObject({ day: '2026-10-12', status: 'unassigned' });
		expect(present(install).site_id).toBe(present(survey).site_id);
		const repeated = yield* as.start('job_assignments_import_work_orders', { rows: decoded });
		expect(repeated.kind).toBe('committed');
		if (repeated.kind !== 'committed') throw new Error('The repeated sheet import did not start.');
		expect(yield* completedRun(t, repeated.output.id)).toMatchObject({
			state: 'succeeded',
			error: null,
			output: { created: 0, skipped: 5 }
		});
		const additional = yield* as.start('job_assignments_import_work_orders', {
			rows: yield* decodeWorkOrders(
				csvRecords(
					'site,postal_code,scheduled_for,title\nBlk 412 Tampines St 41 #07-221,520412,2026-10-26,Defect rectification'
				)
			)
		});
		expect(additional.kind).toBe('committed');
		if (additional.kind !== 'committed')
			throw new Error('The additional sheet import did not start.');
		expect(yield* completedRun(t, additional.output.id)).toMatchObject({
			state: 'succeeded',
			error: null
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
		const raw = yield* Context.get(t.services, Callables).start({
			automation: 'job_assignments_import_work_orders',
			runs: [{ id: crypto.randomUUID(), input: { rows: invalidRows } }],
			authority: as.authority,
			bindings: { now: t.clock.now(), today: '2026-09-25', tz: 'Asia/Singapore', params: {} }
		});
		expect(raw).toMatchObject({ kind: 'refused' });
		if (raw.kind !== 'refused') throw new Error('Invalid raw sheet queued');
		expect(raw.message).toBe(
			'rows.0.scheduled_for: expected a date (YYYY-MM-DD); rows.1.assignee_user_id: expected an id'
		);
		expect(raw.message).toContain('rows.0.scheduled_for');
		expect(raw.message).toContain('rows.1.assignee_user_id');
		expect([yield* count('sites'), yield* count('job_assignments')]).toEqual([4, 6]);
	})
);
it.live('refuses every unresolved site without valid coordinates before writing any row', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.member(CONTROLLER));
		const decoded = yield* decodeWorkOrders(
			csvRecords(
				'site,scheduled_for,title,latitude,longitude\n' +
					'10 First Road,2026-10-01,Valid work,1.3,103.8\n' +
					'20 Second Road,2026-10-01,Missing location,,\n' +
					'30 Third Road,2026-10-01,Out of range,91,181\n' +
					'40 Fourth Road,2026-10-01,Incomplete location,1.3,'
			)
		);
		const started = yield* as.start('job_assignments_import_work_orders', { rows: decoded });
		expect(started.kind).toBe('committed');
		if (started.kind !== 'committed') throw new Error('The invalid-location sheet did not start.');
		const refused = yield* completedRun(t, started.output.id);
		expect(refused).toMatchObject({
			state: 'failed',
			error: {
				code: 'refused',
				message: expect.stringContaining('Row 2: Missing location at 20 Second Road')
			}
		});
		expect(refused.error).toMatchObject({
			message: expect.stringContaining('Row 3: Out of range at 30 Third Road')
		});
		expect(refused.error).toMatchObject({
			message: expect.stringContaining('Row 4: Incomplete location at 40 Fourth Road')
		});
		expect(yield* rows(t, 'SELECT count(*)::int AS n FROM sites')).toEqual([{ n: 0 }]);
		expect(yield* rows(t, 'SELECT count(*)::int AS n FROM job_assignments')).toEqual([{ n: 0 }]);
		const badCoordinate = yield* Effect.flip(
			decodeWorkOrders([
				{
					site: '10 First Road',
					scheduled_for: '2026-10-01',
					title: 'Invalid number',
					latitude: 'somewhere',
					longitude: '103.8'
				}
			])
		);
		expect(badCoordinate.message).toContain('Row 1: latitude:');
	})
);
it.live(
	'rolls back fresh nested work and existing-site work when an admitted assignee disappears',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(yield* person(t, CONTROLLER));
			const assignee = yield* person(t, CONTRACTOR);
			const existing = yield* as.act('sites.create', {
				address: '10 Existing Road, Singapore 500001',
				location: { lat: 1.3, lng: 103.8 }
			});
			expect(existing.kind).toBe('committed');
			const baseline = yield* rows(t, 'SELECT * FROM sites ORDER BY id');
			expect(baseline).toHaveLength(1);
			const decoded = yield* decodeWorkOrders([
				{
					site: '20 New Road',
					postal_code: '500002',
					scheduled_for: '2026-10-01',
					title: 'Fresh nested work',
					latitude: '1.31',
					longitude: '103.81'
				},
				{
					site: '10 Existing Road',
					postal_code: '500001',
					scheduled_for: '2026-10-01',
					title: 'Existing-site work',
					assignee_user_id: assignee.id
				}
			]);
			const started = yield* as.start('job_assignments_import_work_orders', { rows: decoded });
			expect(started.kind).toBe('committed');
			if (started.kind !== 'committed') throw new Error('The mixed sheet import did not start.');
			expect(
				yield* rows(t, 'SELECT state FROM sys_run WHERE id = $1', [started.output.id])
			).toEqual([{ state: 'queued' }]);
			// The input reference was valid at admission; the native batch must reject its disappearance.
			yield* t.db.write({ text: 'DELETE FROM sys_user WHERE id = $1', params: [assignee.id] });
			expect(yield* completedRun(t, started.output.id)).toMatchObject({
				state: 'failed',
				error: { code: 'notFound', message: 'No readable sys_user has this id.' }
			});
			expect(yield* rows(t, 'SELECT * FROM sites ORDER BY id')).toEqual(baseline);
			expect(yield* rows(t, 'SELECT count(*)::int AS n FROM job_assignments')).toEqual([{ n: 0 }]);
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
