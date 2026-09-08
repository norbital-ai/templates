import test from 'node:test';
import assert from 'node:assert/strict';
import { antiSpoofCrop, antiSpoofPixels } from '../src/lib/kiosk/anti-spoof.ts';

test('MiniFASNet gets BGR planes in 0–255, never normalized RGB', () => {
	assert.deepEqual(
		[...antiSpoofPixels(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]))],
		[30, 60, 20, 50, 10, 40]
	);
});

test('both MiniVision crops preserve context and shift inside the camera bounds', () => {
	const image = { width: 480, height: 640 };
	assert.deepEqual(antiSpoofCrop(image, [106, 147, 207, 213], 2.7), [0, 7, 480, 493]);
	assert.deepEqual(antiSpoofCrop(image, [106, 147, 207, 213], 4), [0, 7, 480, 493]);
	assert.deepEqual(antiSpoofCrop(image, [0, 0, 80, 80], 2.7), [0, 0, 217, 217]);
	assert.deepEqual(antiSpoofCrop(image, [400, 560, 80, 80], 4), [159, 319, 321, 321]);
});
