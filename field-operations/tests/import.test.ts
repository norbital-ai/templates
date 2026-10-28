import { present } from './test-runtime.js';
import { Effect } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
/**
 * The work-order sheet import (L-TPL-field-operations-017): the sample xlsx files its jobs once, one new site per
 * address the workspace lacks; a second import files nothing; new work at a filed address lands on that site; a bad
 * sheet is refused whole, naming each faulty row.
 */
import { readFileSync } from 'node:fs';
import { expect, it, layer } from '@effect/vitest';
import { zipSync } from 'fflate';
import { csvRecords } from '../src/lib/csv.ts';
import { xlsxRecords } from '../src/lib/xlsx.ts';
import { decodeWorkOrders } from '../src/lib/work-order-sheet.ts';
import { committed, completedRun, CONTRACTOR, CONTROLLER, person, rows, shared } from './kit.ts';
layer(shared())('work-order sheet import', (it) => {
	it.effect(
		'imports the sample xlsx once, filing a site for every address the workspace lacks',
		() =>
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
				const t = yield* TestWorkspace;
				const as = t.as(t.member(CONTROLLER));
				const count = Effect.fnUntraced(function* (c: string) {
					return Number(present((yield* rows(t, `SELECT count(*)::int AS n FROM ${c}`))[0]).n);
				});
				const sites = yield* count('sites'),
					jobs = yield* count('job_assignments');
				const started = yield* as.start('job_assignments_import_work_orders', { rows: decoded });
				if (started.kind !== 'committed') throw new Error('The sheet import did not start.');
				expect(yield* completedRun(t, started.output.id)).toMatchObject({
					state: 'succeeded',
					error: null,
					output: { created: 5, sites: 4, skipped: 0 }
				});
				expect([yield* count('sites'), yield* count('job_assignments')]).toEqual([
					sites + 4,
					jobs + 5
				]);
				expect(
					present(
						(yield* as.query({ sites: { where: { site_key: { eq: '520412#07-221' } } } })).sites
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
				expect(survey).toMatchObject({ day: '2026-10-12', status: 'pending' });
				expect(present(install).site_id).toBe(present(survey).site_id);
				const repeated = yield* as.start('job_assignments_import_work_orders', { rows: decoded });
				if (repeated.kind !== 'committed')
					throw new Error('The repeated sheet import did not start.');
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
				if (additional.kind !== 'committed')
					throw new Error('The additional sheet import did not start.');
				expect(yield* completedRun(t, additional.output.id)).toMatchObject({
					state: 'succeeded',
					error: null
				});
				expect(yield* count('sites')).toBe(sites + 4);
				const [linked] = yield* rows(
					t,
					`SELECT site_id FROM job_assignments WHERE title = 'Defect rectification'`
				);
				expect(present(linked).site_id).toBe(present(survey).site_id);
			})
	);
	it.effect('refuses every unresolved site without valid coordinates before writing any row', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
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
			if (started.kind !== 'committed')
				throw new Error('The invalid-location sheet did not start.');
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
			expect(
				yield* rows(t, `SELECT count(*)::int AS n FROM job_assignments WHERE title = 'Valid work'`)
			).toEqual([{ n: 0 }]);
		})
	);
	it.effect(
		"links each row's contractor by its email or phone, fresh nested work included, and files the rest without one",
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const as = t.as(yield* person(t, CONTROLLER));
				const assignee = yield* person(t, CONTRACTOR, '+6591234567');
				committed(
					yield* as.act('sites.create', [
						{ address: '10 Existing Road, Singapore 500001', location: { lat: 1.3, lng: 103.8 } }
					])
				);
				const decoded = yield* decodeWorkOrders([
					{
						site: '20 New Road',
						postal_code: '500002',
						scheduled_for: '2026-10-01',
						title: 'Fresh nested work',
						latitude: '1.31',
						longitude: '103.81',
						assignee_contact: '9123 4567'
					},
					{
						site: '10 Existing Road',
						postal_code: '500001',
						scheduled_for: '2026-10-01',
						title: 'Existing-site work',
						assignee_contact: `${assignee.id}@FIELD.test`
					},
					{
						site: '10 Existing Road',
						postal_code: '500001',
						scheduled_for: '2026-10-01',
						title: 'Unknown contractor',
						assignee_contact: 'nobody@field.test'
					}
				]);
				const started = yield* as.start('job_assignments_import_work_orders', { rows: decoded });
				if (started.kind !== 'committed')
					throw new Error('The contact sheet import did not start.');
				expect(yield* completedRun(t, started.output.id)).toMatchObject({
					state: 'succeeded',
					output: { created: 3, sites: 1, skipped: 0 }
				});
				expect(
					yield* rows(
						t,
						`SELECT title, assignee_user_id FROM job_assignments WHERE title IN ('Existing-site work', 'Fresh nested work', 'Unknown contractor') ORDER BY title`
					)
				).toEqual([
					{ title: 'Existing-site work', assignee_user_id: assignee.id },
					{ title: 'Fresh nested work', assignee_user_id: assignee.id },
					{ title: 'Unknown contractor', assignee_user_id: null }
				]);
			})
	);
});
it.effect('refuses a sheet whole, naming each faulty row', () =>
	Effect.gen(function* () {
		const day = yield* Effect.flip(
			decodeWorkOrders([{ site: '1 Nowhere Rd', scheduled_for: '2026-13-40', title: 'Survey' }])
		);
		expect(day).toMatchObject({ _tag: 'SheetInvalid' });
		expect(day.message).toMatch(/Row 1: .*calendar day/);
		const coordinate = yield* Effect.flip(
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
		expect(coordinate.message).toContain('Row 1: latitude:');
	})
);
it('keeps the public workbook refusal messages for invalid ZIP and no worksheet', async () => {
	await expect(Effect.runPromise(xlsxRecords(new Uint8Array([1, 2, 3]).buffer))).rejects.toThrow(
		'This file is not an xlsx workbook.'
	);
	const empty = zipSync({});
	await expect(
		Effect.runPromise(
			xlsxRecords(empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength))
		)
	).rejects.toThrow('This workbook has no worksheet.');
});
it('imports bare-CR CSV rows with the same normalized header and cell contract', () => {
	expect(csvRecords('﻿Site,TITLE\r A,Install\r')).toEqual([{ site: 'A', title: 'Install' }]);
});
