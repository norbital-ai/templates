import { afterEach, expect, it, vi } from '@effect/vitest';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { captureMeetingAudio } from '../src/lib/meeting-capture.js';

function browser(failure?: 'construct' | 'start') {
	const release = vi.fn<() => void>();
	const stop = vi.fn<() => void>();
	class Recorder {
		static isTypeSupported() {
			return true;
		}
		state = 'inactive';
		mimeType = 'audio/mp4';
		onstop: (() => void) | null = null;
		constructor() {
			if (failure === 'construct') throw new Error('construct failed');
		}
		start() {
			if (failure === 'start') throw new Error('start failed');
			this.state = 'recording';
		}
		stop() {
			stop();
			this.state = 'inactive';
			this.onstop?.();
		}
	}
	vi.stubGlobal('navigator', {
		mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: release }] }) }
	});
	vi.stubGlobal('MediaRecorder', Recorder);
	return { release, stop };
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

for (const failure of ['construct', 'start'] satisfies readonly Exclude<
	Parameters<typeof browser>[0],
	undefined
>[]) {
	it.effect(`releases the microphone when ${failure} fails`, () =>
		Effect.gen(function* () {
			const { release } = browser(failure);
			const error = yield* Effect.flip(
				captureMeetingAudio({ denied: 'denied', ready() {}, tick() {} })
			);
			expect(error.cause).toMatchObject({ message: `${failure} failed` });
			expect(release).toHaveBeenCalledTimes(1);
		})
	);
}

it.effect('releases resources on normal stop', () =>
	Effect.gen(function* () {
		const { release, stop } = browser();
		const tick = vi.fn();
		const audio = yield* captureMeetingAudio({
			denied: 'denied',
			tick,
			ready(recorder) {
				recorder.stop();
			}
		});
		expect(audio).toEqual({ parts: [], mimeType: 'audio/mp4' });
		expect(release).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
		yield* TestClock.adjust('3 seconds');
		expect(tick).not.toHaveBeenCalled();
	})
);

it.effect('releases the recorder, microphone and timer on interruption', () =>
	Effect.gen(function* () {
		const { release, stop } = browser();
		const tick = vi.fn();
		const ready = yield* Deferred.make<void>();
		const fiber = yield* Effect.forkChild(
			captureMeetingAudio({
				denied: 'denied',
				tick,
				ready() {
					Effect.runSync(Deferred.succeed(ready, undefined));
				}
			})
		);
		yield* Deferred.await(ready);
		yield* TestClock.adjust('1 second');
		expect(tick).toHaveBeenCalledTimes(1);
		yield* TestClock.adjust('1 second');
		expect(tick).toHaveBeenCalledTimes(2);
		yield* Fiber.interrupt(fiber);
		expect(release).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
		yield* TestClock.adjust('3 seconds');
		expect(tick).toHaveBeenCalledTimes(2);
	})
);
