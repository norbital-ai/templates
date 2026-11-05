import type Human from '@vladmandic/human';
import { attach } from '@norbital-ai/ui/effect';
import { Clock, Effect, FiberSet, Result, Schedule, type Fiber, type Scope } from 'effect';
import { KIOSK_LOOP_MS } from './config.js';
import { closeCamera, openCamera, warmFaceEngine } from './face.js';
import { loadAntiSpoof, releaseAntiSpoof } from './anti_spoof.js';

type AntiSpoof = Effect.Success<ReturnType<typeof loadAntiSpoof>>;
type AntiSpoofFailure = Effect.Error<ReturnType<typeof loadAntiSpoof>>;
export function createKioskSession(options: {
	readonly boot: () => void;
	readonly ready: (
		stream: MediaStream,
		human: Human,
		spoof: Result.Result<AntiSpoof, AntiSpoofFailure>
	) => void;
	readonly clock: (now: Date) => void;
	readonly scan: () => Effect.Effect<unknown, never, Scope.Scope>;
	readonly failed: (failure: unknown) => void;
	readonly disposed: () => void;
}) {
	let reset: Fiber.Fiber<void, never> | null = null;
	let startReset: ((effect: Effect.Effect<void>) => Fiber.Fiber<void, never>) | null = null;
	let mounted: object | null = null;
	const cancelReset = () => {
		reset?.interruptUnsafe();
		reset = null;
	};
	return {
		cancelReset,
		resumeAfter: (delay: number, resume: () => void) => {
			cancelReset();
			if (startReset !== null)
				reset = startReset(Effect.sleep(delay).pipe(Effect.andThen(Effect.sync(resume))));
		},
		attach: attach<HTMLElement>(() => {
			const attachment = {};
			return Effect.gen(function* () {
				mounted = attachment;
				cancelReset();
				options.boot();
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						if (mounted !== attachment) return;
						mounted = null;
						cancelReset();
						startReset = null;
						options.disposed();
					})
				);
				startReset = yield* FiberSet.makeRuntime<never, void, never>();
				yield* Effect.forkScoped(
					Effect.gen(function* () {
						const now = new Date(yield* Clock.currentTimeMillis);
						if (mounted === attachment) options.clock(now);
					}).pipe(Effect.repeat(Schedule.spaced('1 second')))
				);
				yield* Effect.scoped(
					Effect.gen(function* () {
						const stream = yield* Effect.acquireRelease(
							openCamera({ ideal: 'user' }),
							(stream) => Effect.sync(() => closeCamera(stream)),
							{ interruptible: true }
						);
						const { human, spoof } = yield* Effect.all(
							{
								human: Effect.acquireRelease(
									warmFaceEngine(false),
									(human) => Effect.sync(() => human.reset()),
									{ interruptible: true }
								),
								spoof: Effect.result(
									Effect.acquireRelease(loadAntiSpoof(), releaseAntiSpoof, { interruptible: true })
								)
							},
							{ concurrency: 'unbounded' }
						);
						if (mounted !== attachment) return;
						options.ready(stream, human, spoof);
						yield* options.scan().pipe(Effect.repeat(Schedule.spaced(KIOSK_LOOP_MS)));
					})
				).pipe(
					Effect.catch((failure) =>
						Effect.sync(() => {
							if (mounted === attachment) options.failed(failure);
						})
					)
				);
				yield* Effect.never;
			});
		})
	};
}
