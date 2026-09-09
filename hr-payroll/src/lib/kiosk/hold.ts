import { KIOSK_CONFIRMATION_SECONDS, KIOSK_LIVE_MIN } from './config.js';
import { KIOSK_MATCH_THRESHOLD } from './embed.js';

export type KioskHold = Readonly<{
	/** The first embedding of the hold: every later frame must still be this person. */
	probe: readonly number[];
	/** The newest embedding: what recognition is asked about while the hold runs. */
	embedding: readonly number[];
	startedAt: number;
	seenAt: number;
	/** Smoothed MiniFASNet live score: one dim frame does not end a hold, a spoof or a dim run does. */
	liveScore: number;
}>;

/**
 * The weight of the newest frame in the smoothed live score. At 0.4 a steady 0.99 hold survives one
 * frame at 0.6 (0.83) but not two in a row (0.74) or one frame at 0.2 (0.67).
 */
const KIOSK_LIVE_SMOOTHING = 0.4;

export const sameKioskPerson = (first: readonly number[], second: readonly number[]): boolean => {
	if (first.length !== second.length) return false;
	let firstNorm = 0;
	let secondNorm = 0;
	let dot = 0;
	for (let i = 0; i < first.length; i++) {
		const a = first[i]!;
		const b = second[i]!;
		firstNorm += a * a;
		secondNorm += b * b;
		dot += a * b;
	}
	const norm = firstNorm * secondNorm;
	return Number.isFinite(norm) && norm > 0 && 1 - dot / Math.sqrt(norm) <= KIOSK_MATCH_THRESHOLD;
};

/**
 * Camera observations own the hold. A server response cannot start or extend it, and neither can
 * the clock: the scan loop resets the hold itself on every frame without a readable face, so a slow
 * device whose frames arrive a second apart still accumulates its two seconds. Liveness is judged
 * on the hold's running mean, so one frame that dips under the line while the person blinks or the
 * light flickers keeps the hold; a run of them or a frame that plainly fails ends it, and a frame
 * under the line starts nothing.
 */
export const observeKioskHold = (
	previous: KioskHold | null,
	face: Readonly<{ embedding: readonly number[]; liveScore: number }> | null,
	now: number
): KioskHold | null => {
	if (face === null || !Number.isFinite(face.liveScore)) return null;
	if (!sameKioskPerson(face.embedding, face.embedding)) return null;
	const continuing =
		previous !== null && now >= previous.seenAt && sameKioskPerson(previous.probe, face.embedding);
	const liveScore = continuing
		? previous.liveScore * (1 - KIOSK_LIVE_SMOOTHING) + face.liveScore * KIOSK_LIVE_SMOOTHING
		: face.liveScore;
	if (liveScore < KIOSK_LIVE_MIN) return null;
	return {
		probe: continuing ? previous.probe : [...face.embedding],
		embedding: [...face.embedding],
		startedAt: continuing ? previous.startedAt : now,
		seenAt: now,
		liveScore
	};
};

export const kioskSecondsLeft = (hold: KioskHold): number =>
	Math.max(0, Math.ceil(KIOSK_CONFIRMATION_SECONDS - (hold.seenAt - hold.startedAt) / 1000));
