// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte';
import { idsOf } from '@norbital-ai/ui';
import { mountEdge, runningFibers } from '@norbital-ai/ui/effect';
import { Layer, ManagedRuntime } from 'effect';
import type Human from '@vladmandic/human';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FaceEnrollment from '../../src/lib/ui/person/face_enroll_flow.svelte';

const sdk = vi.hoisted(() => ({
	open: vi.fn<MediaDevices['getUserMedia']>(),
	stop: vi.fn<MediaStreamTrack['stop']>(),
	load: vi.fn<Human['load']>(),
	warm: vi.fn<Human['warmup']>(),
	reset: vi.fn<Human['reset']>(),
	detect: vi.fn<Human['detect']>()
}));
vi.mock('$bolt', () => ({ bolt: { locale: 'en', t: (key: string) => key } }));
vi.mock('../../src/kiosk/attendance/settings.js', () => ({
	readKioskSettings: () => ({ voiceEnabled: false })
}));
vi.mock('@vladmandic/human', () => ({
	default: class {
		constructor(readonly config: ConstructorParameters<typeof Human>[0]) {}
		models: Pick<Human['models'], 'loaded'> = {
			loaded: () => ['blazeface', 'facemesh', 'iris', 'faceres']
		};
		load = sdk.load;
		warmup = sdk.warm;
		reset = sdk.reset;
		detect = sdk.detect;
	}
}));
const mounted = new Set<() => Promise<void>>();
const pendingSdk = new Set<() => void>();
let closeEdge: (() => Promise<void>) | undefined;
beforeEach(() => {
	closeEdge = mountEdge(ManagedRuntime.make(Layer.empty));
	vi.stubGlobal(
		'navigator',
		new Proxy(navigator, {
			get: (target, key) =>
				key === 'mediaDevices' ? { getUserMedia: sdk.open } : Reflect.get(target, key, target)
		})
	);
	vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
	sdk.load.mockResolvedValue(undefined);
	sdk.warm.mockResolvedValue(undefined);
});
afterEach(async () => {
	for (const resolve of pendingSdk) resolve();
	pendingSdk.clear();
	for (const close of mounted) await close();
	await closeEdge?.();
	closeEdge = undefined;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Object.values(sdk).forEach((mock) => mock.mockReset());
});
const settle = async () => {
	for (let n = 0; n < 5; n++) {
		flushSync();
		await tick();
	}
};
function open() {
	const [id] = idsOf<'employment_profile'>(['fixture-profile']);
	if (id === undefined) throw new Error('Missing profile fixture.');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(FaceEnrollment, {
		target,
		props: { record: { id }, onsaved: () => {}, onclose: () => {} }
	});
	const close = async () => {
		await unmount(app);
		target.remove();
		mounted.delete(close);
	};
	mounted.add(close);
	return { close };
}
function stream() {
	const camera = document.createElement('canvas').captureStream();
	// Happy DOM supplies real canvas tracks and MediaStream identity, but omits getTracks().
	camera.getTracks = () => [...camera.getAudioTracks(), ...camera.getVideoTracks()];
	for (const track of camera.getTracks()) {
		const stop = track.stop.bind(track);
		vi.spyOn(track, 'stop').mockImplementation(() => {
			sdk.stop();
			stop();
		});
	}
	return camera;
}

it('a camera granted after unmount is immediately closed without warming a model', async () => {
	const camera = stream(),
		pending = Promise.withResolvers<MediaStream>();
	pendingSdk.add(() => pending.resolve(camera));
	sdk.open.mockReturnValue(pending.promise);
	const { close } = open();
	await vi.waitFor(() => expect(sdk.open).toHaveBeenCalledOnce());
	await close();
	sdk.stop.mockClear();
	pending.resolve(camera);
	await settle();
	await vi.waitFor(() => expect(runningFibers()).toBe(0));
	expect(sdk.stop).toHaveBeenCalledOnce();
	expect(camera.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
	expect(sdk.load).not.toHaveBeenCalled();
	expect(sdk.warm).not.toHaveBeenCalled();
});

it('a model arriving after unmount is reset and cannot restart the camera loop', async () => {
	const camera = stream(),
		pending = Promise.withResolvers<Awaited<ReturnType<Human['warmup']>>>();
	pendingSdk.add(() => pending.resolve(undefined));
	sdk.open.mockResolvedValue(camera);
	sdk.warm.mockReturnValue(pending.promise);
	const { close } = open();
	await vi.waitFor(() => expect(sdk.warm).toHaveBeenCalledOnce());
	await close();
	sdk.reset.mockClear();
	pending.resolve(undefined);
	await settle();
	await vi.waitFor(() => expect(runningFibers()).toBe(0));
	expect(sdk.reset).toHaveBeenCalledOnce();
	expect(sdk.stop).toHaveBeenCalledOnce();
	expect(camera.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
	expect(sdk.warm).toHaveBeenCalledOnce();
	expect(sdk.detect).not.toHaveBeenCalled();
});
