/**
 * The workspace compiles, migrates and restores its public base pack (the three fixture rows), and each 06:00 digest
 * is a cron automation whose run output is its JSON extract (L-TPL-construction-009..012).
 */
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { testWorkspace } from '@norbital-ai/bolt/test';

const root = fileURLToPath(new URL('..', import.meta.url));

it('restores the public base pack and runs the permit expiry digest', async () => {
	const t = await testWorkspace({ root });
	const admin = t.as(t.admin);
	const projects = await admin.read('projects', { select: { project_number: true }, all: true });
	expect(projects.rows.map((r) => r['project_number'])).toEqual(['PUB-PRJ-0001']);
	expect((await admin.read('certification_types', { all: true })).rows).toHaveLength(1);
	expect((await admin.read('workers', { all: true })).rows).toHaveLength(1);

	for (const a of [
		'defect_closeout_digest',
		'payment_claim_readiness_watch',
		'permit_expiry_watch',
		'rfi_followup_watch'
	])
		expect(t.manifest.automations[a]).toMatchObject({
			on: { cron: '0 6 * * *' },
			runAs: ['construction_read']
		});

	const project = String(projects.rows[0]!['id']);
	await admin.act('permits_to_work.create', {
		permit_number: 'PTW-1',
		project_id: project,
		status: 'active'
	});
	const id = crypto.randomUUID();
	expect(await admin.start('permit_expiry_watch', {}, { id })).toMatchObject({ kind: 'committed' });
	await t.runDue();
	const run = await t.engine.runs!.view(t.engine.authority(t.admin), id);
	expect(run).toMatchObject({
		status: 'succeeded',
		result: { count: 1, rows: [{ permit_number: 'PTW-1' }] }
	});
});
