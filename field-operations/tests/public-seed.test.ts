import { Effect } from 'effect';
/**
 * The public `base` pack is this template's invented fixtures, read through `seed/seed.ts`'s conversions; the bank's
 * rows ship only in the private sample (L-TPL-ALL-004). The fixtures name no member, so every assignee is left empty.
 */
import { expect, it } from '@effect/vitest';
import { workspace } from './kit.ts';
it.live(
	'restores the public base pack: invented sites, jobs and chat lines, no member and no photo',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace({ seed: 'base' });
			const admin = t.as(t.admin);
			const sites = (yield* admin.read('sites', { all: true })).rows;
			expect(sites).toHaveLength(6);
			expect(sites.every((s) => String(s.site_code).startsWith('PUB-SITE-'))).toBe(true);
			const jobs = (yield* admin.read('job_assignments', { all: true })).rows;
			expect(jobs.length).toBeGreaterThan(0);
			expect(jobs.every((j) => j.assignee_user_id === null)).toBe(true);
			expect((yield* admin.read('communication_logs', { limit: 1 })).rows).toHaveLength(1);
			expect((yield* admin.read('photo_evidence', { all: true })).rows).toEqual([]);
		})
);
