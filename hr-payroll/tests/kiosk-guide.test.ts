import test from 'node:test';
import assert from 'node:assert/strict';
import { silhouetteGeometry } from '../src/lib/kiosk/silhouette.ts';
import {
	GUIDED_POSES,
	guidedCaptureComplete,
	initialGuidedCapture,
	observePose,
	poseProgress,
	targetPose
} from '../src/lib/kiosk/guided-capture.ts';

const radians = (value: number): number => (value * Math.PI) / 180;

test('the silhouette head is human-sized: 58% of the frame height, shoulders past the bottom edge', () => {
	const geometry = silhouetteGeometry({ width: 1280, height: 720 });
	assert.equal(geometry.head.ry * 2, 417.6);
	assert.equal(geometry.head.cx, 640);
	assert.ok(geometry.head.rx < geometry.head.ry, 'the head is narrower than it is tall');
	assert.ok(geometry.neck.bottom > geometry.neck.top, 'a gap separates chin and shoulders');
	assert.ok(geometry.shoulders.bottom > 720, 'the shoulders leave the frame at the bottom');
	assert.match(geometry.shoulders.path, /^M[\d.]+ [\d.]+ C .* M[\d.]+ [\d.]+ C /);
});

test('a frame too narrow for the shoulders shrinks the whole figure to fit', () => {
	const geometry = silhouetteGeometry({ width: 300, height: 720 });
	assert.ok(geometry.head.ry * 2 < 720 * 0.58, 'the head gives up height on a narrow frame');
	const widest = geometry.head.rx * 2.1 * 2;
	assert.ok(widest <= 300 * 0.92 + 0.01, `shoulders ${widest} exceed 92% of the frame width`);
	const zero = silhouetteGeometry({ width: 0, height: 0 });
	assert.ok(Number.isFinite(zero.head.rx), 'an unmeasured frame still yields finite geometry');
});

test('guided capture takes the five poses in order, each after a steady hold with an embedding', () => {
	let state = initialGuidedCapture();
	assert.equal(targetPose(state), 'straight');
	const angles = {
		straight: { yaw: 0, pitch: 0 },
		left: { yaw: radians(25), pitch: 0 },
		right: { yaw: radians(-25), pitch: 0 },
		up: { yaw: 0, pitch: radians(-20) },
		down: { yaw: 0, pitch: radians(20) }
	};
	let now = 1_000;
	// The left pose held while straight is pending is not the current pose: no capture.
	assert.equal(observePose(state, { angle: angles.left, embedding: true }, now).capture, null);
	for (const pose of GUIDED_POSES) {
		assert.equal(targetPose(state), pose);
		const first = observePose(state, { angle: angles[pose], embedding: true }, now);
		assert.equal(first.capture, null, 'the first frame in the window only starts the hold');
		state = first.state;
		assert.ok(
			poseProgress(state, pose, now + 300) > 0.4 && poseProgress(state, pose, now + 300) < 0.6
		);
		const early = observePose(state, { angle: angles[pose], embedding: true }, now + 300);
		assert.equal(early.capture, null);
		state = early.state;
		const done = observePose(state, { angle: angles[pose], embedding: true }, now + 600);
		assert.equal(done.capture, pose);
		state = done.state;
		assert.equal(poseProgress(state, pose, now + 600), 1);
		now += 1_000;
	}
	assert.ok(guidedCaptureComplete(state));
	assert.equal(targetPose(state), null);
	assert.equal(observePose(state, { angle: angles.down, embedding: true }, now).capture, null);
});

test('leaving the window, losing the embedding or losing the face restarts the hold', () => {
	let state = initialGuidedCapture();
	state = observePose(state, { angle: { yaw: 0, pitch: 0 }, embedding: true }, 0).state;
	assert.equal(state.heldSince, 0);
	state = observePose(state, { angle: { yaw: 0, pitch: 0 }, embedding: false }, 200).state;
	assert.equal(state.heldSince, null, 'no embedding: the hold restarts');
	state = observePose(state, { angle: { yaw: 0, pitch: 0 }, embedding: true }, 300).state;
	state = observePose(state, { angle: { yaw: radians(20), pitch: 0 }, embedding: true }, 500).state;
	assert.equal(state.heldSince, null, 'out of the window: the hold restarts');
	state = observePose(state, { angle: { yaw: 0, pitch: 0 }, embedding: true }, 600).state;
	state = observePose(state, null, 800).state;
	assert.equal(state.heldSince, null);
	assert.equal(state.facePresent, false, 'no face is reported so the flow can say so');
	// A steady 600 ms from a fresh start captures; the earlier broken holds never count.
	state = observePose(state, { angle: { yaw: 0, pitch: 0 }, embedding: true }, 900).state;
	assert.equal(
		observePose(state, { angle: { yaw: 0, pitch: 0 }, embedding: true }, 1_499).capture,
		null
	);
	assert.equal(
		observePose(state, { angle: { yaw: 0, pitch: 0 }, embedding: true }, 1_500).capture,
		'straight'
	);
});
