/**
 * The public `base` pack is this template's invented fixtures, read through `seed/seed.ts`'s conversions; the bank's
 * rows ship only in the private sample (L-TPL-ALL-004). The fixtures name no member, so every assignee is left empty.
 */
import { expect, it } from 'vitest';
import { workspace } from './kit.ts';

it('restores the public base pack: invented sites, jobs and chat lines, no member and no photo', async () => {
	const t = await workspace({ seed: 'base' });
	const admin = t.as(t.admin);
	const sites = (await admin.read('sites', { all: true })).rows;
	expect(sites).toHaveLength(6);
	expect(sites.every((s) => String(s['site_code']).startsWith('PUB-SITE-'))).toBe(true);
	const jobs = (await admin.read('job_assignments', { all: true })).rows;
	expect(jobs.length).toBeGreaterThan(0);
	expect(jobs.every((j) => j['assignee_user_id'] === null)).toBe(true);
	expect((await admin.read('communication_logs', { limit: 1 })).rows).toHaveLength(1);
	expect((await admin.read('photo_evidence', { all: true })).rows).toEqual([]);
});
