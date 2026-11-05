import type { Id, Row } from '@norbital-ai/bolt';
import { expect, it } from '@effect/vitest';
import { reviewCandidatesFrom } from '../src/lib/suspicion-evidence.ts';
import { fixtureId } from './test-runtime.js';

it('retains the newest decoded review evidence in first-seen order', () => {
	const photo = (n: number) =>
		fixtureId('photo_evidence', `019f6f10-0003-7000-8000-00000000000${n}`);
	const first = photo(1);
	const second = photo(2);
	const photoA = photo(3);
	const photoB = photo(4);
	const duplicate = photo(5);
	const stale = photo(6);
	const basis = (
		candidates: Row<'suspicion_reviews'>['basis']['candidates']
	): Row<'suspicion_reviews'>['basis'] => ({
		kind: 'review',
		assignment: {
			id: 'job',
			site_id: 'site',
			title: 'Survey',
			nature: null,
			scheduled_for: '2026-10-12',
			description: '',
			status: 'pending',
			summary: null,
			location: null
		},
		job: { id: 'job', title: 'Survey', nature: null, scheduled_for: '2026-10-12', description: '' },
		site: null,
		photos: [],
		communications: [],
		candidates
	});
	const candidate = (
		id: Id<'photo_evidence'>,
		distance: number,
		matched_photo_ids: Id<'photo_evidence'>[]
	) => ({
		id,
		distance,
		matched_photo_ids,
		file_id: 'file',
		sha256: 'hash',
		flags: []
	});
	const newest = basis([
		candidate(first, 0.1, [photoA]),
		candidate(first, 0.9, [duplicate]),
		candidate(second, 0.2, [photoB])
	]);
	const older = basis([candidate(first, 0.5, [stale])]);
	expect(reviewCandidatesFrom([newest, older])).toEqual([
		{ id: first, distance: 0.1, matchedPhotoIds: [photoA] },
		{ id: second, distance: 0.2, matchedPhotoIds: [photoB] }
	]);
});
