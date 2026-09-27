/**
 * The work-order sheet import (L-TPL-field-operations-017): the sample xlsx files its jobs once, one new site per
 * address the workspace lacks; a second import files nothing; new work at a filed address lands on that site; a bad
 * sheet is refused whole, naming each faulty row.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { csvRecords } from '../src/lib/csv.ts';
import { xlsxRecords } from '../src/lib/xlsx.ts';
import { CONTROLLER, rows, workspace } from './kit.ts';

it('imports the sample xlsx once, filing a site for every address the workspace lacks', async () => {
	const bytes = readFileSync('tests/fixtures/job-import.xlsx');
	const sheet = await xlsxRecords(
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
	const t = await workspace();
	const as = t.as(t.member(CONTROLLER));
	const count = async (c: string) =>
		Number((await rows(t, `SELECT count(*)::int AS n FROM ${c}`))[0]!['n']);

	expect(await as.act('job_assignments.import_work_orders', { rows: sheet })).toMatchObject({
		kind: 'committed',
		output: { created: 5, sites: 4, skipped: 0 }
	});
	expect([await count('sites'), await count('job_assignments')]).toEqual([4, 5]);
	const [survey, install] = await rows(
		t,
		`SELECT site_id, scheduled_for::text AS day, status FROM job_assignments WHERE external_ref IN ('IMP-1001', 'IMP-1002') ORDER BY external_ref`
	);
	expect(survey).toMatchObject({ day: '2026-10-12', status: 'unassigned' });
	expect(install!['site_id']).toBe(survey!['site_id']);

	expect(await as.act('job_assignments.import_work_orders', { rows: sheet })).toMatchObject({
		output: { created: 0, skipped: 5 }
	});
	await as.act('job_assignments.import_work_orders', {
		rows: csvRecords(
			'site,postal_code,scheduled_for,title\nBlk 412 Tampines St 41 #07-221,520412,2026-10-26,Defect rectification'
		)
	});
	expect(await count('sites')).toBe(4);
	const [linked] = await rows(
		t,
		`SELECT site_id FROM job_assignments WHERE title = 'Defect rectification'`
	);
	expect(linked!['site_id']).toBe(survey!['site_id']);

	const bad = await as.act('job_assignments.import_work_orders', {
		rows: [
			{ site: '1 Nowhere Rd', scheduled_for: '2026-13-40', title: 'A' },
			{ site: '1 Nowhere Rd', scheduled_for: '2026-10-01', title: 'B', assignee_user_id: 'bob' }
		]
	});
	expect(bad).toMatchObject({ kind: 'refused' });
	expect((bad as { message: string }).message).toMatch(
		/Row 1: .*calendar day[\s\S]*Row 2: .*user id/
	);
});
