import { KIOSK_CONFIRMATION_SECONDS, KIOSK_LIVE_MIN } from './config.js';
import { KIOSK_MATCH_THRESHOLD } from './embed.js';

export type KioskHold = Readonly<{
	probe: readonly number[];
	startedAt: number;
	seenAt: number;
}>;

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

/** Camera observations own the hold. A server response cannot start or extend it. */
export const observeKioskHold = (
	previous: KioskHold | null,
	face: Readonly<{ embedding: readonly number[]; liveScore: number }> | null,
	now: number
): KioskHold | null => {
	if (face === null || !Number.isFinite(face.liveScore) || face.liveScore < KIOSK_LIVE_MIN)
		return null;
	if (!sameKioskPerson(face.embedding, face.embedding)) return null;
	const continuing =
		previous !== null &&
		now >= previous.seenAt &&
		now - previous.seenAt <= 700 &&
		sameKioskPerson(previous.probe, face.embedding);
	return {
		probe: continuing ? previous.probe : [...face.embedding],
		startedAt: continuing ? previous.startedAt : now,
		seenAt: now
	};
};

export const kioskSecondsLeft = (hold: KioskHold): number =>
	Math.max(0, Math.ceil(KIOSK_CONFIRMATION_SECONDS - (hold.seenAt - hold.startedAt) / 1000));
