// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { loadAntiSpoof, scoreAntiSpoof } from '../../src/kiosk/attendance/anti_spoof.js';

const sdk = vi.hoisted(() => ({
	run: vi.fn(),
	release: vi.fn(),
	disposed: vi.fn(),
	pixels: vi.fn()
}));
vi.mock('onnxruntime-web/wasm', () => ({
	env: { wasm: {} },
	Tensor: class {
		dispose() {
			sdk.disposed(this);
		}
	},
	InferenceSession: { create: async () => ({ run: sdk.run, release: sdk.release }) }
}));
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Object.values(sdk).forEach((mock) => mock.mockReset());
});

async function scene() {
	sdk.run.mockResolvedValue({});
	const session = await Effect.runPromise(loadAntiSpoof());
	sdk.run.mockReset();
	sdk.disposed.mockClear();
	vi.stubGlobal(
		'CanvasRenderingContext2D',
		class {
			drawImage() {}
			getImageData() {
				return sdk.pixels();
			}
		}
	);
	const image = document.createElement('canvas'),
		crop = document.createElement('canvas');
	image.width = image.height = 160;
	vi.spyOn(crop, 'getContext').mockReturnValue(new CanvasRenderingContext2D());
	sdk.pixels.mockReturnValue({ data: new Uint8ClampedArray(80 * 80 * 4) });
	return { session, image, crop };
}

it('a malformed prediction releases both inputs and all returned tensors', async () => {
	const { session, image, crop } = await scene();
	const output = { dispose: vi.fn() };
	sdk.run.mockResolvedValue({ another: output });
	await expect(
		Effect.runPromise(scoreAntiSpoof(session, image, [20, 20, 40, 40], crop))
	).rejects.toThrow('no probabilities');
	expect(output.dispose).toHaveBeenCalledOnce();
	expect(sdk.disposed).toHaveBeenCalledTimes(2);
});

it('a failed second crop releases the first tensor before any model call', async () => {
	const { session, image, crop } = await scene();
	sdk.pixels
		.mockReturnValueOnce({ data: new Uint8ClampedArray(80 * 80 * 4) })
		.mockImplementationOnce(() => {
			throw new Error('Image became unavailable');
		});
	await expect(
		Effect.runPromise(scoreAntiSpoof(session, image, [20, 20, 40, 40], crop))
	).rejects.toThrow('Image became unavailable');
	expect(sdk.run).not.toHaveBeenCalled();
	expect(sdk.disposed).toHaveBeenCalledOnce();
});
