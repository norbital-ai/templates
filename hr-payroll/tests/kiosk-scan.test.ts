import test from 'node:test';
import assert from 'node:assert/strict';
import { silhouetteGeometry, faceInsideSilhouette, fitFrame } from '../src/lib/kiosk/silhouette.ts';
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
		hold = observeKioskHold(hold, { ...live, embedding: [0.97, 0.03, 0] }, now);
		assert.ok(hold);
		assert.equal(hold.probe, probe, 'the first frame anchors the whole hold');
		assert.deepEqual(hold.embedding, [0.97, 0.03, 0], 'the newest frame is what recognition sees');
		assert.equal(hold.startedAt, 100);
		assert.equal(kioskSecondsLeft(hold), Math.ceil((2100 - now) / 1000));
	}
});

test('liveness is smoothed: one dim frame keeps the hold, a dim run, a spoof or a dim start ends it', () => {
	let hold = observeKioskHold(null, live, 0);
	for (let now = 100; now < 1000; now += 100) hold = observeKioskHold(hold, live, now);
	assert.ok(hold);
	const dimmed = observeKioskHold(hold, { ...live, liveScore: 0.6 }, 1000);
	assert.ok(dimmed, 'a blink under the line inside a live hold does not restart it');
	assert.equal(dimmed.startedAt, 0);
	assert.equal(observeKioskHold(dimmed, { ...live, liveScore: 0.6 }, 1100), null, 'two in a row');
	assert.equal(
		observeKioskHold(hold, { ...live, liveScore: 0.2 }, 1000),
		null,
		'a photo swapped in'
	);
	assert.equal(observeKioskHold(null, { ...live, liveScore: 0.6 }, 0), null);
});

test('leaving, spoofing or changing person cannot finish a prior hold; slow frames can', () => {
	const hold = observeKioskHold(null, live, 0);
	assert.ok(hold);
	assert.equal(observeKioskHold(hold, null, 100), null);
	assert.equal(observeKioskHold(hold, { ...live, liveScore: 0.2 }, 100), null);
	assert.equal(observeKioskHold(hold, { ...live, embedding: [0, 0, 0] }, 100), null);
	const swapped = observeKioskHold(hold, { ...live, embedding: [0, 1, 0] }, 100);
	assert.ok(swapped);
	assert.notEqual(swapped.probe, hold.probe);
	assert.equal(swapped.startedAt, 100);
	// A tablet whose inference takes a second per frame still accumulates its two seconds.
	const slow = observeKioskHold(hold, live, 2000);
	assert.ok(slow);
	assert.equal(slow.probe, hold.probe);
	assert.equal(kioskSecondsLeft(slow), 0);
});

test('the frame keeps the camera ratio inside any cell', () => {
	assert.deepEqual(fitFrame({ width: 1000, height: 1000 }, { width: 1280, height: 720 }), {
		width: 1000,
		height: 562.5
	});
	assert.deepEqual(fitFrame({ width: 1000, height: 300 }, { width: 1280, height: 720 }), {
		width: 533.33,
		height: 300
	});
	assert.deepEqual(fitFrame({ width: 768, height: 500 }, { width: 720, height: 1280 }), {
		width: 281.25,
		height: 500
	});
});

test('the accepted face is centred in the head and at least a third of its height, at any size', () => {
	for (const frame of [
		{ width: 1280, height: 720 },
		{ width: 700, height: 900 },
		{ width: 300, height: 180 }
	]) {
		const { head } = silhouetteGeometry(frame);
		const image = { width: frame.width / 2, height: frame.height / 2 };
		const centred = (share: number) =>
			[
				(head.cx - head.rx * share) / 2,
				(head.cy - head.ry * share) / 2,
				head.rx * share,
				head.ry * share
			] as const;
		assert.equal(faceInsideSilhouette(centred(0.5), image, frame), true);
		assert.equal(
			faceInsideSilhouette(centred(0.36), image, frame),
			true,
			'a step back still reads'
		);
		assert.equal(faceInsideSilhouette(centred(1.3), image, frame), true, 'a step in still reads');
		assert.equal(faceInsideSilhouette(centred(0.3), image, frame), false, 'too far is background');
		const box = centred(0.5);
		const offCentre = [box[0] + (head.rx * 0.9) / 2, box[1], box[2], box[3]] as const;
		assert.equal(faceInsideSilhouette(offCentre, image, frame), true, 'off to one side inside');
		assert.equal(faceInsideSilhouette([0, 0, box[2], box[3]], image, frame), false);
		assert.equal(faceInsideSilhouette([head.cx / 2, head.cy / 2, 2, 2], image, frame), false);
	}
});
