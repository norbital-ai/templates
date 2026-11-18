import { Effect, Result, Schedule, Schema } from 'effect';

const TYPES = ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
const MAX_BYTES = 19.5 * 1024 * 1024;

export class MeetingCaptureFailed extends Schema.TaggedError<MeetingCaptureFailed>()(
	'MeetingCaptureFailed',
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect())
	}
) {}

/** Browser capture only. Scoped release owns microphone, recorder and elapsed-time schedule. */
export const captureMeetingAudio = Effect.fn('Meeting.captureAudio')(
	(options: {
		denied: string;
		ready(recorder: MediaRecorder): void;
		tick(): void;
		chunk?(part: Blob): void;
	}) =>
		Effect.scoped(
			Effect.gen(function* () {
				const stream = yield* Effect.acquireRelease(
					Effect.tryPromise({
						try: (signal) =>
							navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
								if (signal.aborted) stream.getTracks().forEach((track) => track.stop());
								return stream;
							}),
						catch: (cause) => new MeetingCaptureFailed({ message: options.denied, cause })
					}),
					(stream) => Effect.sync(() => stream.getTracks().forEach((track) => track.stop()))
				);
				const recorder = yield* Effect.acquireRelease(
					Effect.try({
						try: () => {
							const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
							return new MediaRecorder(stream, {
								...(mimeType ? { mimeType } : {}),
								audioBitsPerSecond: 32_000
							});
						},
						catch: (cause) => new MeetingCaptureFailed({ message: options.denied, cause })
					}),
					(recorder) =>
						Effect.sync(() => {
							recorder.ondataavailable = null;
							recorder.onstop = null;
							recorder.onerror = null;
							if (recorder.state !== 'inactive') recorder.stop();
						})
				);
				const parts: Blob[] = [];
				let size = 0;
				yield* Effect.sync(() => {
					if (recorder.state === 'recording') options.tick();
				}).pipe(
					Effect.repeat(Schedule.spaced('1 second')),
					Effect.delay('1 second'),
					Effect.forkScoped
				);
				yield* Effect.callback<void, MeetingCaptureFailed>((resume) => {
					recorder.ondataavailable = (event) => {
						if (event.data.size > 0) {
							parts.push(event.data);
							options.chunk?.(event.data);
						}
						size += event.data.size;
						if (size >= MAX_BYTES && recorder.state === 'recording') recorder.stop();
					};
					recorder.onstop = () => resume(Effect.void);
					recorder.onerror = (event) =>
						resume(
							Effect.fail(new MeetingCaptureFailed({ message: options.denied, cause: event }))
						);
					// Registration starts capture; a returned Effect would run only on interruption.
					const started = Result.try({
						try: () => {
							recorder.start(2_000);
							options.ready(recorder);
						},
						catch: (cause) => new MeetingCaptureFailed({ message: options.denied, cause })
					});
					if (Result.isFailure(started)) resume(Effect.fail(started.failure));
				});
				return { parts, mimeType: recorder.mimeType };
			})
		)
);
