import test from 'node:test';
import assert from 'node:assert/strict';
import { silhouetteGeometry, faceInsideSilhouette } from '../src/lib/kiosk/silhouette.ts';
import { observeKioskHold, kioskSecondsLeft, sameKioskPerson } from '../src/lib/kiosk/hold.ts';

const live = { embedding: [1, 0, 0], liveScore: 0.99 };

test('the completed person stays suppressed while another person can start immediately', () => {
	assert.equal(sameKioskPerson(live.embedding, [0.95, 0.02, 0.01]), true);
	assert.equal(sameKioskPerson(live.embedding, [0, 1, 0]), false);
	for (const invalid of [[], [0, 0, 0], [NaN, 0, 0], [Infinity, 0, 0], [1]]) {
		assert.equal(sameKioskPerson(live.embedding, invalid), false);
	}
});

test('only a live face starts the two-second hold; matching time is part of that hold', () => {
	assert.equal(observeKioskHold(null, null, 0), null);
	for (const liveScore of [0, 0.79, NaN, Infinity]) {
		assert.equal(observeKioskHold(null, { ...live, liveScore }, 0), null);
	}
	let hold = observeKioskHold(null, live, 100);
	assert.ok(hold);
	const probe = hold.probe;
	assert.equal(kioskSecondsLeft(hold), 2);
	for (let now = 200; now <= 2100; now += 100) {
		hold = observeKioskHold(hold, live, now);
		assert.ok(hold);
		assert.equal(hold.probe, probe, 'one match request owns this entire hold');
		assert.equal(hold.startedAt, 100);
		assert.equal(kioskSecondsLeft(hold), Math.ceil((2100 - now) / 1000));
	}
});

test('leaving, spoofing, changing person or stalled observations cannot finish a prior hold', () => {
	const hold = observeKioskHold(null, live, 0);
	assert.ok(hold);
	assert.equal(observeKioskHold(hold, null, 100), null);
	assert.equal(observeKioskHold(hold, { ...live, liveScore: 0.2 }, 100), null);
	assert.equal(observeKioskHold(hold, { ...live, embedding: [0, 0, 0] }, 100), null);
	const swapped = observeKioskHold(hold, { ...live, embedding: [0, 1, 0] }, 100);
	assert.ok(swapped);
	assert.notEqual(swapped.probe, hold.probe);
	assert.equal(swapped.startedAt, 100);
	const stalled = observeKioskHold(hold, live, 2000);
	assert.ok(stalled);
	assert.notEqual(stalled.probe, hold.probe);
	assert.equal(kioskSecondsLeft(stalled), 2);
});

test('the accepted face area follows the rendered silhouette at wide, tall and narrow sizes', () => {
	for (const frame of [
		{ width: 1280, height: 720 },
		{ width: 700, height: 900 },
		{ width: 300, height: 180 }
	]) {
		const { head } = silhouetteGeometry(frame);
		const image = { width: frame.width / 2, height: frame.height / 2 };
		const box = [
			(head.cx - head.rx / 2) / 2,
			(head.cy - head.ry / 2) / 2,
			head.rx / 2,
			head.ry / 2
		] as const;
		assert.equal(faceInsideSilhouette(box, image, frame), true);
		assert.equal(faceInsideSilhouette([0, 0, box[2], box[3]], image, frame), false);
		assert.equal(
			faceInsideSilhouette([box[0], box[1], image.width, image.height], image, frame),
			false
		);
		assert.equal(faceInsideSilhouette([head.cx / 2, head.cy / 2, 2, 2], image, frame), false);
	}
});
