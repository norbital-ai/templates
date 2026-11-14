import { present } from './test-runtime.js';
import { Effect, Layer } from 'effect';
import { Convert } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { JobResult, TestWorkspace, type Caller } from '@norbital-ai/bolt-cli/test';
import type { Json } from '@norbital-ai/bolt';
/**
 * The work-order sheet import (L-TPL-field-operations-017): the sample sheet files its jobs once, one new site per
 * address the workspace lacks; a second import files nothing; new work at a filed address lands on that site; a bad
 * sheet is refused whole, naming each faulty row. The host's converter reads the upload; here a fake answers each
 * file's sheet by its name.
 */
import { expect, it, layer } from '@effect/vitest';
import { decodeWorkOrders, sheetRecords } from '../src/lib/work-order-sheet.ts';
import {
	committed,
	completedRun,
	CONTRACTOR,
	CONTROLLER,
	person,
	rootRows,
	rows,
	shared
} from './kit.ts';

type Sheet = { readonly columns: readonly string[]; readonly rows: readonly (readonly Json[])[] };
/** What the fake converter answers for each uploaded file name. */
const sheets = new Map<string, Sheet>();
const SheetConvert = Layer.succeed(Convert, {
	targets: [],
	convert: () =>
		Effect.fail(new FacilityFailure({ kind: 'invalid', message: 'no conversion expected' })),
	ingest: (file) =>
		Effect.sync(() => {
			const sheet = sheets.get(file.name);
			return sheet === undefined
				? { unsupported: file.name }
				: {
						kind: 'data' as const,
						json: {
							sheets: [{ columns: [...sheet.columns], rows: sheet.rows.map((row) => [...row]) }]
						},
						images: [],
						meta: { stats: { pages: null, bytes: 0, cpuMs: 0, wallMs: 0 } }
					};
		})
});
/** A CSV's header and rows as the converter reads them. */
const csv = (text: string): Sheet => {
	const [header = '', ...lines] = text.split('\n');
	return { columns: header.split(','), rows: lines.map((line) => line.split(',')) };
};
let uploads = 0;
/** Uploads `sheet` as the automation's file input and starts the import; answers the run id. */
const importSheet = Effect.fnUntraced(function* (as: Caller, sheet: Sheet) {
	const name = `sheet-${++uploads}.csv`;
	sheets.set(name, sheet);
	const uploaded = yield* as.upload('job_assignments_import_work_orders.$input.file', {
		name,
		mime: 'text/csv',
		bytes: new TextEncoder().encode(name)
	});
	if (uploaded.kind !== 'committed') throw new Error('The sheet upload was held.');
	const started = yield* as.run(
		'job_assignments_import_work_orders',
		{ file: uploaded.output },
		JobResult
	);
	if (started.kind !== 'committed') throw new Error('The sheet import did not start.');
	return started.output.id;
});
/** The sample work-order workbook as the converter reads it: day serials, blank cells null. */
const SAMPLE: Sheet = {
	columns: [
		'site',
		'postal_code',
		'scheduled_for',
		'title',
		'nature',
		'description',
		'assignee_contact',
		'external_ref',
		'unit_number',
		'latitude',
		'longitude'
	],
	rows: [
		[
			'Blk 412 Tampines Street 41',
			'520412',
			46307,
			'Survey — Blk 412 Tampines St 41',
			'Survey',
			'Site survey for window grille replacement.',
			null,
			'IMP-1001',
			'#07-221',
			1.3572,
			103.9466
		],
		[
			'Blk 412 Tampines Street 41 #07-221',
			'520412',
			46314,
			'Installation — Blk 412 Tampines St 41',
			'Installation',
			'Install 4 window grilles per survey.',
			null,
			'IMP-1002',
			null,
			1.3572,
			103.9466
		],
		[
			'27 Jalan Kembangan',
			'419137',
			46308,
			'Leak inspection — 27 Jalan Kembangan',
			'Inspection',
			'Inspect roof leak above master bedroom.',
			null,
			'IMP-1003',
			null,
			1.3199,
			103.9167
		],
		[
			'8 Marina View #21-04, Singapore 018960',
			null,
			46309,
			'Aircon servicing — Asia Square',
			'Maintenance',
			'Service 6 FCUs on level 21.',
			null,
			null,
			null,
			1.2794,
			103.8536
		],
		[
			'Blk 133 Bedok North Ave 3 #05-12',
			'460133',
			46310,
			'Handover — Blk 133 Bedok North',
			'Handover',
			'Final walkthrough and key handover.',
			null,
			'IMP-1005',
			null,
			1.3273,
			103.9334
		]
	]
};
layer(shared({ ports: SheetConvert }))('work-order sheet import', (it) => {
	it.effect(
		'imports the sample sheet once, filing a site for every address the workspace lacks',
		() =>
			Effect.gen(function* () {
				const first = present(SAMPLE.rows[0]);
				expect(sheetRecords({ columns: [...SAMPLE.columns], rows: [[...first]] })[0]).toEqual({
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
				const t = yield* TestWorkspace;
				const as = yield* t.as(t.member(CONTROLLER));
				const count = Effect.fnUntraced(function* (c: string) {
					return Number(present((yield* rows(t, `SELECT count(*)::int AS n FROM ${c}`))[0]).n);
				});
				const sites = yield* count('sites'),
					jobs = yield* count('job_assignments');
				const run = yield* importSheet(as, SAMPLE);
				expect(yield* completedRun(t, run)).toMatchObject({
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
						rootRows(
							yield* as.query({ sites: { where: { site_key: { eq: '520412#07-221' } } } }),
							'sites'
						)[0]
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
				const repeated = yield* importSheet(as, SAMPLE);
				expect(yield* completedRun(t, repeated)).toMatchObject({
					state: 'succeeded',
					error: null,
					output: { created: 0, skipped: 5 }
				});
				const additional = yield* importSheet(
					as,
					csv(
						'site,postal_code,scheduled_for,title\nBlk 412 Tampines St 41 #07-221,520412,2026-10-26,Defect rectification'
					)
				);
				expect(yield* completedRun(t, additional)).toMatchObject({
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
	it.effect(
		'refuses a sheet with a new site lacking valid coordinates before writing any row',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const as = yield* t.as(t.member(CONTROLLER));
				const started = yield* importSheet(
					as,
					csv(
						'site,scheduled_for,title,latitude,longitude\n' +
							'10 First Road,2026-10-01,Valid work,1.3,103.8\n' +
							'20 Second Road,2026-10-01,Missing location,,\n' +
							'30 Third Road,2026-10-01,Out of range,91,181\n' +
							'40 Fourth Road,2026-10-01,Incomplete location,1.3,'
					)
				);
				const refused = yield* completedRun(t, started);
				expect(refused).toMatchObject({
					state: 'failed',
					error: {
						code: 'refused',
						message:
							'The sheet could not be imported: row 2 (Missing location at 20 Second Road on 2026-10-01): a new site needs latitude (-90 to 90) and longitude (-180 to 180).'
					}
				});
				expect(
					yield* rows(
						t,
						`SELECT count(*)::int AS n FROM job_assignments WHERE title = 'Valid work'`
					)
				).toEqual([{ n: 0 }]);
			})
	);
	it.effect(
		"links each row's contractor by its email or phone, fresh nested work included, and files the rest without one",
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const as = yield* t.as(yield* person(t, CONTROLLER));
				const assignee = yield* person(t, CONTRACTOR, '+6591234567');
				committed(
					yield* as.act({
						'sites.create': [
							{
								address: '10 Existing Road, Singapore 500001',
								location: { lat: 1.3, lng: 103.8 }
							}
						]
					})
				);
				const started = yield* importSheet(as, {
					columns: [
						'site',
						'postal_code',
						'scheduled_for',
						'title',
						'latitude',
						'longitude',
						'assignee_contact'
					],
					rows: [
						[
							'20 New Road',
							'500002',
							'2026-10-01',
							'Fresh nested work',
							'1.31',
							'103.81',
							'9123 4567'
						],
						[
							'10 Existing Road',
							'500001',
							'2026-10-01',
							'Existing-site work',
							null,
							null,
							`${assignee.id}@FIELD.test`
						],
						[
							'10 Existing Road',
							'500001',
							'2026-10-01',
							'Unknown contractor',
							null,
							null,
							'nobody@field.test'
						]
					]
				});
				expect(yield* completedRun(t, started)).toMatchObject({
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
