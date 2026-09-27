/**
 * L-TPL-construction-008: an assignment is refused unless the worker's active, in-force permits cover every
 * certification some job at that site requires; it is re-checked when the worker or the site changes.
 */
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { testWorkspace } from '@norbital-ai/bolt/test';

const UNCERTIFIED = /Worker must satisfy at least one site-location job requirement/;

it('refuses an uncertified worker and admits a covered one, on create and on a move', async () => {
	const t = await testWorkspace({ root: fileURLToPath(new URL('..', import.meta.url)) });
	const admin = t.as(t.admin);
	const id = async (callable: string, input: object) => {
		const outcome = await admin.act(callable, input as never);
		if (outcome.kind !== 'committed') throw new Error(`${callable}: ${JSON.stringify(outcome)}`);
		return outcome.records[0]!.id;
	};
	const [certA, certB] = [
		await id('certification_types.create', { certification_name: 'A' }),
		await id('certification_types.create', { certification_name: 'B' })
	];
	const [site, bare] = [
		await id('site_locations.create', { location_name: 'Tower' }),
		await id('site_locations.create', { location_name: 'Yard' })
	];
	const job = await id('jobs.create', { job_title: 'Steel' });
	await id('jobs_site_locations.create', { job_id: job, site_location_id: site });
	await id('jobs_certification_types.create', { job_id: job, certification_type_id: certA });
	await id('jobs_certification_types.create', { job_id: job, certification_type_id: certB });
	const worker = await id('workers.create', { worker_name: 'Dan' });
	const permit = await id('permits_to_work.create', {
		permit_number: 'PTW-1',
		status: 'active',
		validity_range: { from: '2026-01-01', to: '2026-12-31' }
	});
	await id('permits_to_work_workers.create', { permits_to_work_id: permit, worker_id: worker });
	await id('permits_to_work_certification_types.create', {
		permits_to_work_id: permit,
		certification_type_id: certA
	});

	const assign = { worker_id: worker, site_location_id: site, status: 'assigned' };
	expect(await admin.act('job_assignments.create', assign)).toMatchObject({
		kind: 'refused',
		message: expect.stringMatching(UNCERTIFIED)
	});

	await id('permits_to_work_certification_types.create', {
		permits_to_work_id: permit,
		certification_type_id: certB
	});
	const assignment = await id('job_assignments.create', assign);

	// a move to a site whose jobs require nothing is refused; an edit that leaves worker and site alone is not re-judged
	expect(
		await admin.act('job_assignments.update', {
			target: assignment,
			set: { site_location_id: bare }
		})
	).toMatchObject({ kind: 'refused', message: expect.stringMatching(UNCERTIFIED) });
	t.clock.set('2027-02-01T00:00:00.000Z');
	expect(
		await admin.act('job_assignments.update', { target: assignment, set: { status: 'completed' } })
	).toMatchObject({
		kind: 'committed'
	});
	// once the permit has lapsed, a new assignment is refused
	expect(await admin.act('job_assignments.create', assign)).toMatchObject({ kind: 'refused' });
});
