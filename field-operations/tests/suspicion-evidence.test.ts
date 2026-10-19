import type { Row } from '@norbital-ai/bolt';
import { expect, it } from '@effect/vitest';
import { reviewCandidatesFrom } from '../src/lib/suspicion-evidence.ts';

it('retains the newest decoded review evidence in first-seen order', () => {
	const first = '019f6f10-0003-7000-8000-000000000001';
	const second = '019f6f10-0003-7000-8000-000000000002';
	const photoA = '019f6f10-0003-7000-8000-000000000003';
	const photoB = '019f6f10-0003-7000-8000-000000000004';
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
			status: 'assigned',
			summary: null,
			location: null
		},
		job: { id: 'job', title: 'Survey', nature: null, scheduled_for: '2026-10-12', description: '' },
		site: null,
		photos: [],
		communications: [],
		candidates
	});
	const candidate = (id: string, distance: number, matched_photo_ids: string[]) => ({
		id,
		distance,
		matched_photo_ids,
		file_id: 'file',
		sha256: 'hash',
		flags: []
	});
	const newest = basis([
		candidate(first, 0.1, [photoA]),
		candidate(first, 0.9, ['duplicate']),
		candidate(second, 0.2, [photoB])
	]);
	const older = basis([candidate(first, 0.5, ['older'])]);
	expect(reviewCandidatesFrom([newest, older])).toEqual([
		{ id: first, distance: 0.1, matchedPhotoIds: [photoA] },
		{ id: second, distance: 0.2, matchedPhotoIds: [photoB] }
	]);
});
