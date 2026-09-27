/**
 * The data rules, one light check each: site identity, dispatch stamps and the review reset, create-only identity keys,
 * photo provenance, append-only ledgers, and a finding resolved once.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { siteKey } from '../src/lib/site-key.ts';
import { committed, CONTROLLER, person, rows, siteWithJob, workspace } from './kit.ts';

describe('the template', () => {
	it('declares what its catalogue card says', () => {
		const files = readdirSync('src', { recursive: true }).map(String);
		const count = (pattern: RegExp) => files.filter((file) => pattern.test(file)).length;
		expect({
			collections: count(/^data\/collection\/[^/]+\/\+collection\.ts$/),
			apps: count(/^app\/.+\/\+app\.ts$/),
			automations: count(/^automation\/\+[^/]+\.automation\.ts$/)
		}).toEqual(JSON.parse(readFileSync('norbital.template.json', 'utf8')).counts);
	});

	it('a Singapore address is its postal code plus its unit, spelled one way', () => {
		expect(siteKey('58 Kismis Avenue, Singapore 598235')).toBe('598235');
		expect(siteKey('Blk 460133 #5-12')).toBe('460133#05-12');
		expect(siteKey('Edelweiss 119 #02-06, Singapore')).toBe('EDELWEISS 119#02-06');
		expect(siteKey('12  Block  Road Street Drive Avenue')).toBe('12 BLK RD ST DR AVE');
		expect(siteKey('3 Ridgewood', '3 RIDGEWOOD CLOSE SINGAPORE 276694 #16-03')).toBe(
			'276694#16-03'
		);
	});
});

describe('sites', () => {
	it('an address already filed is refused with the site that carries it', async () => {
		const t = await workspace();
		const as = t.as(t.member(CONTROLLER));
		committed(await as.act('sites.create', { name: '58 Kismis Ave, S598235' }));
		const again = await as.act('sites.create', { name: '58 Kismis Avenue, Singapore 598235' });
		expect(again).toMatchObject({
			kind: 'refused',
			message: 'A site at this address already exists: 58 Kismis Ave, S598235.'
		});
	});

	it('work filed under a site is dispatched by its transform', async () => {
		const t = await workspace();
		const as = t.as(t.member(CONTROLLER));
		committed(
			await as.act('sites.create', {
				name: '6 Sunset Vale, Singapore 597232',
				job_assignments: {
					create: [{ title: 'Survey', scheduled_for: '2026-09-25', description: 'Measure' }]
				}
			})
		);
		const [job] = await rows(t, `SELECT status, search_text FROM job_assignments`);
		expect(job).toMatchObject({
			status: 'unassigned',
			search_text: 'Survey, 6 Sunset Vale, Singapore 597232'
		});
	});
});

describe('job assignments', () => {
	it('naming a contractor dispatches once, completing stamps once, and any change but the stamp makes the job unread', async () => {
		const t = await workspace();
		const { job } = await siteWithJob(t);
		const as = t.as(t.member(CONTROLLER));
		const read = async () =>
			(await rows(t, `SELECT * FROM job_assignments WHERE id = $1`, [job]))[0]!;
		expect(await read()).toMatchObject({ status: 'unassigned', dispatched_at: null });
		const [bob] = await rows(
			t,
			`INSERT INTO sys_user (id, email, name, kind) VALUES (gen_random_uuid(), 'bob@x.test', 'Bob', 'staff') RETURNING id`
		);
		committed(
			await as.act('job_assignments.update', {
				target: job,
				set: { assignee_user_id: bob!['id'], status: 'assigned' }
			})
		);
		const dispatched = (await read())['dispatched_at'];
		expect(dispatched).not.toBeNull();
		committed(
			await as.act('job_assignments.update', { target: job, set: { status: 'completed' } })
		);
		const completed = (await read())['completed_at'];
		t.clock.advance('1h');
		committed(await as.act('job_assignments.update', { target: job, set: { summary: 'done' } }));
		expect(await read()).toMatchObject({
			dispatched_at: dispatched,
			completed_at: completed,
			suspicion_checked_at: null
		});
	});

	it('identity keys are create-only, and the review stamp is not a controller field', async () => {
		const t = await workspace();
		const { job } = await siteWithJob(t, { external_ref: 'IMP-1' });
		const as = t.as(t.member(CONTROLLER));
		expect(
			await as.act('job_assignments.update', { target: job, set: { external_ref: 'IMP-2' } })
		).toMatchObject({ kind: 'refused' });
		expect(
			await as.act('job_assignments.update', {
				target: job,
				set: { suspicion_checked_at: '2026-09-25T10:00:00.000Z' }
			})
		).toMatchObject({ kind: 'refused' });
	});
});

describe('photo evidence', () => {
	it('a filed photo is an uninspected workspace upload whose provenance never changes', async () => {
		const t = await workspace();
		const { job } = await siteWithJob(t);
		const other = await siteWithJob(t);
		const as = t.as(t.admin);
		const up = await as.upload('photo_evidence.photo', {
			name: 'p.jpg',
			mime: 'image/jpeg',
			bytes: readFileSync('tests/fixtures/photo-evidence.jpg')
		});
		const file = (up as { output: unknown }).output;
		expect(await as.act('photo_evidence.create', { photo: file })).toMatchObject({
			kind: 'refused'
		}); // no parent
		const [photo] = committed(
			await as.act('photo_evidence.create', {
				job_assignment_id: job,
				photo: file,
				source: {
					kind: 'channel',
					provider: 'x',
					conversation_id: 'c',
					message_id: 'm',
					attachment_id: 'a',
					sender_id: 's'
				}
			})
		);
		const [row] = await rows(
			t,
			`SELECT source, sha256, summary, flags FROM photo_evidence WHERE id = $1`,
			[photo]
		);
		expect(row).toMatchObject({
			source: { kind: 'workspace_upload' },
			sha256: '',
			summary: 'Workspace upload',
			flags: []
		});
		expect(
			await as.act('photo_evidence.update', {
				target: photo!,
				set: { job_assignment_id: other.job }
			})
		).toMatchObject({
			kind: 'refused',
			message:
				'Photo evidence provenance is immutable; create new evidence to change its photo or parent.'
		});
	});
});

describe('the ledgers', () => {
	it('messages and reviews are append-only; a human finding composes its basis and is resolved once', async () => {
		const t = await workspace();
		const { job } = await siteWithJob(t);
		const as = t.as(await person(t, CONTROLLER));
		const [log] = committed(
			await as.act('communication_logs.create', {
				job_assignment_id: job,
				message: 'done',
				sent_at: '2026-09-25T10:00:00.000Z',
				sender: 'bob',
				source_message_id: 'm1'
			})
		);
		expect(
			await as.act('communication_logs.update', { target: log!, set: { message: 'edited' } })
		).toMatchObject({ kind: 'refused' });
		const [finding] = committed(
			await as.act('suspicious_activity_logs.create', {
				job_assignment_id: job,
				reason: 'Two sites in one set'
			})
		);
		const [stored] = await rows(
			t,
			`SELECT basis, origin, source_key FROM suspicious_activity_logs WHERE id = $1`,
			[finding]
		);
		expect(JSON.parse(String(stored!['basis']))).toMatchObject({
			kind: 'human_judgement',
			reason: 'Two sites in one set'
		});
		expect(stored!['source_key']).toMatch(new RegExp(`^human:${job}:[0-9a-f]{64}$`));
		committed(
			await as.act('suspicious_activity_logs.resolve', {
				target: finding!,
				input: { resolution: 'Same site, two doors' }
			})
		);
		expect(
			await as.act('suspicious_activity_logs.resolve', {
				target: finding!,
				input: { resolution: 'again' }
			})
		).toMatchObject({
			kind: 'refused'
		});
		expect(
			await as.act('suspicious_activity_logs.create', {
				job_assignment_id: job,
				origin: 'automation',
				reason: 'x'
			})
		).toMatchObject({
			kind: 'refused',
			message: 'An automated suspicion judgement must supply its reviewed evidence basis.'
		});
	});
});
