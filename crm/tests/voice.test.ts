import { runAutomation } from '@norbital-ai/bolt-cli/test';
import { Context, Effect, Layer } from 'effect';
import { TestWorkspace, JobResult } from '@norbital-ai/bolt-cli/test';
import { describe, expect, it } from '@effect/vitest';
import {
	cosine,
	enrol,
	fbank,
	mono,
	speakerRanges,
	suggest,
	recognise,
	VOICE_MATCH_THRESHOLD
} from '../src/lib/voice.js';
import { member, nativeId, targetOf, pageOf } from './workspace.js';

const NOW = '2026-10-19T02:00:00.000Z';

/**
 * Speaker identification runs in the browser (the model is never loaded here): its feature, enrolment and suggestion
 * functions, and the consent-gated enrolment that saves a voice to a contact.
 */
const at = (i: number) => Array.from({ length: 4 }, (_, j) => (i === j ? 1 : 0));

describe('voice features', () => {
	it('matches Kaldi fbank (kaldi-native-fbank, 80 bins, dither 0, mean removed)', () => {
		const samples = Float32Array.from(
			{ length: 8000 },
			(_, i) =>
				(i / 8000) *
				(0.3 * Math.sin((2 * Math.PI * 440 * i) / 16000) +
					0.1 * Math.sin((2 * Math.PI * 1830 * i) / 16000 + 1))
		);
		const features = fbank(samples);
		expect(features.length).toBe(48 * 80);
		const golden: Array<[number, number[]]> = [
			[0, [-1.3048, -5.3572, -5.4104, 0]],
			[20, [-0.1017, 0.1975, 0.2051, 0]],
			[47, [1.665, 1.847, 1.8453, 0]]
		];
		for (const [frame, values] of golden)
			[0, 10, 40, 79].forEach((bin, i) =>
				expect(features[frame * 80 + bin]).toBeCloseTo(values[i] ?? NaN, 2)
			);
	});
	it('has no frames under 25 ms, and silence stays finite', () => {
		expect(fbank(new Float32Array(399))).toHaveLength(0);
		expect(fbank(new Float32Array(16000)).every(Number.isFinite)).toBe(true);
	});
	it('averages channels', () => {
		expect(Array.from(mono([Float32Array.of(1, 0), Float32Array.of(0, 1)]))).toEqual([0.5, 0.5]);
	});
	it('takes a speaker’s segments of a second or more, capped at a minute', () => {
		const segments = [
			{ speaker: 'S1', start: 0, end: 0.5 },
			{ speaker: 'S2', start: 0.5, end: 3 },
			{ speaker: 'S1', start: 3, end: 50 },
			{ speaker: 'S1', start: 60, end: 80 }
		];
		expect(speakerRanges(segments, 'S1')).toEqual([
			[48_000, 800_000],
			[960_000, 1_168_000]
		]);
		expect(speakerRanges(segments, 'S3')).toEqual([]);
	});
});

describe('voice profiles', () => {
	it('compares by cosine', () => {
		expect(cosine([1, 0], [2, 0])).toBe(1);
		expect(cosine([1, 0], [0, 3])).toBe(0);
		expect(cosine([0, 0], [1, 0])).toBe(0);
	});
	it('enrols a running mean of unit vectors', () => {
		expect(enrol(null, 0, [3, 0, 0, 0])).toEqual([1, 0, 0, 0]);
		const two = enrol([1, 0, 0, 0], 1, [0, 5, 0, 0]);
		expect(two[0]).toBeCloseTo(Math.SQRT1_2);
		expect(two[1]).toBeCloseTo(Math.SQRT1_2);
		// a third meeting weighs a third against the stored (unit) profile
		const three = enrol(two, 2, at(2));
		expect(cosine(three, [Math.SQRT2, Math.SQRT2, 1, 0])).toBeCloseTo(1);
		expect(Math.hypot(...three)).toBeCloseTo(1);
	});
	it('suggests the best profile at or above the threshold, else none', () => {
		const profiles = [
			{ id: 'a', name: 'Aaron', embedding: at(0) },
			{ id: 'b', name: 'Bea', embedding: [0.8, 0.6, 0, 0] },
			{ id: 'c', name: 'Cy', embedding: at(3) }
		];
		expect(suggest([0.9, 0.44, 0, 0], profiles)?.name).toBe('Bea');
		expect(suggest([0.3, 0, 1, 0], profiles)).toBeNull();
		expect(VOICE_MATCH_THRESHOLD).toBe(0.75);
		expect(suggest(at(0), [], 0)).toBeNull();
	});
	it('suggests no profile for a new voice near 0.72, nor between two close profiles', () => {
		const a = { id: 'a', name: 'Aaron', embedding: at(0) };
		const newVoice = [0.72, Math.sqrt(1 - 0.72 ** 2), 0, 0];
		expect(suggest(newVoice, [a])).toBeNull();
		const strong = [0.9, Math.sqrt(1 - 0.9 ** 2), 0, 0];
		expect(suggest(strong, [a])?.score).toBeCloseTo(0.9);
		// Bea scores ~0.92 against the same voice: within the margin of Aaron's 0.9, so neither is offered
		const bea = { id: 'b', name: 'Bea', embedding: [0.66, 0.75, 0, 0] };
		expect(suggest(strong, [a, bea])).toBeNull();
	});
	it('automatically recognises only strong, unambiguous matches', () => {
		const a = { id: 'a', name: 'Aaron', embedding: at(0) };
		expect(recognise(at(0), [a])?.id).toBe('a');
		expect(recognise([0.7, Math.sqrt(1 - 0.7 ** 2), 0, 0], [a])).toBeNull();
		expect(
			recognise(at(0), [a, { id: 'b', name: 'Bea', embedding: [0.99, 0.1, 0, 0] }])
		).toBeNull();
		expect(recognise(at(0), [])).toBeNull();
	});
});

const fixture = (n: number) => `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// `seed/test`: Aaron, without a profile, tagged as S1 and again as `S1 repeated` in the first meeting; S2 untagged
// in the next
it.live(
	'enrols an assigned voice with explicit consent once per meeting, then recognises a later meeting',
	() =>
		Effect.gen(function* () {
			const t = Context.get(
				yield* Layer.build(TestWorkspace.layer({ root: `${process.cwd()}/`, now: NOW })),
				TestWorkspace
			);
			const sales = yield* t.as(yield* member(t, ['sales', 'crm']));
			const contact = nativeId('contacts', fixture(24));
			const speaker = nativeId('meeting_speakers', fixture(41));
			const repeated = nativeId('meeting_speakers', fixture(42));
			const recognised = nativeId('meeting_speakers', fixture(43));
			const voice = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
			const save = (target: typeof speaker, over: { consent?: true; automatic?: true } = {}) =>
				runAutomation(
					t,
					sales.run(
						'meeting_speakers_save_voice',
						{ meeting_speakers: [target], contact, embedding: voice, ...over },
						JobResult
					)
				);
			const profile = sales
				.query({ contacts: { where: { id: { eq: contact } }, limit: 1 } })
				.pipe(Effect.map((answer) => pageOf(answer, 'contacts').rows[0] ?? null));
			const speakerRow = (id: typeof speaker) =>
				sales
					.query({ meeting_speakers: { where: { id: { eq: id } }, limit: 1 } })
					.pipe(Effect.map((answer) => pageOf(answer, 'meeting_speakers').rows[0] ?? null));

			expect(yield* save(speaker)).toMatchObject({ state: 'failed', error: { code: 'refused' } });
			expect(yield* profile).toMatchObject({ voice_samples: 0, voice_consent_at: null });
			yield* save(speaker, { consent: true });
			expect(yield* profile).toMatchObject({
				voice_samples: 1,
				voice_embedding: voice,
				voice_consent_at: NOW
			});
			expect(yield* speakerRow(speaker)).toMatchObject({ contact, voice_enrolled_at: NOW });
			// a diarizer's second label for the same person: the meeting still counts once
			yield* save(repeated);
			expect(yield* profile).toMatchObject({ voice_samples: 1 });

			yield* save(recognised, { automatic: true });
			expect(yield* speakerRow(recognised)).toMatchObject({ contact });
			expect(yield* profile).toMatchObject({ voice_samples: 2, voice_last_match_at: NOW });
			// reassigned to someone else: no longer enrolled for that meeting
			yield* sales.act({
				'meeting_speakers.update': [
					{
						target: yield* targetOf(t, 'meeting_speakers', recognised),
						set: { contact: nativeId('contacts', fixture(23)) }
					}
				]
			});
			expect(yield* speakerRow(recognised)).toMatchObject({ voice_enrolled_at: null });
		}).pipe(Effect.scoped)
);
