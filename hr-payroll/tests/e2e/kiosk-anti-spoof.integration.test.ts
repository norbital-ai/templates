import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { guestUrlForChromium, launchChromiumOrSkip } from '@norbital-ai/test-utilities';
import { KIOSK_REQUIRED_MODELS } from '../../src/lib/kiosk/config.ts';

it('the browser runs the packaged MiniFASNet model, passes the real sample and rejects both spoofs', async () => {
	const realm = new URL('../../../../AGENTS.md', import.meta.url);
	const scratchRoot = existsSync(realm)
		? fileURLToPath(new URL('../../../../.tmp/', import.meta.url))
		: join(tmpdir(), 'norbital-scratch');
	await mkdir(scratchRoot, { recursive: true });
	const scratch = await mkdtemp(join(scratchRoot, 'kiosk-model-test-'));
	const root = fileURLToPath(new URL('../../', import.meta.url));
	const files = new Map<string, { path: string; type: string }>([
		['/assets/anti-spoof.js', { path: join(scratch, 'anti-spoof.js'), type: 'text/javascript' }],
		...['minifasnet.onnx', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map(
			(name) =>
				[
					`/models/minifas/${name}`,
					{
						path: join(root, '.norbital/dist/models/minifas', name),
						type: name.endsWith('.wasm')
							? 'application/wasm'
							: name.endsWith('.mjs')
								? 'text/javascript'
								: 'application/octet-stream'
					}
				] as const
		),
		...['image_T1.jpg', 'image_F1.jpg', 'image_F2.jpg', 'reference.json'].map(
			(name) =>
				[
					`/fixtures/${name}`,
					{
						path: join(root, 'tests/fixtures/kiosk', name),
						type: name.endsWith('.json') ? 'application/json' : 'image/jpeg'
					}
				] as const
		)
	]);
	const requested = new Set<string>();
	for (const name of KIOSK_REQUIRED_MODELS)
		for (const suffix of ['json', 'bin']) {
			files.set(`/models/human/${name}.${suffix}`, {
				path: join(root, '.norbital/dist/models/human', `${name}.${suffix}`),
				type: suffix === 'json' ? 'application/json' : 'application/octet-stream'
			});
		}
	const server = createServer(async (request, response) => {
		const path = request.url ?? '/';
		requested.add(path);
		if (path === '/') {
			response.setHeader('content-type', 'text/html');
			response.end('<!doctype html><title>Kiosk model test</title>');
			return;
		}
		const file = files.get(path);
		if (file === undefined) {
			response.writeHead(404).end();
			return;
		}
		try {
			response.setHeader('content-type', file.type);
			response.end(await readFile(file.path));
		} catch {
			response.writeHead(500).end();
		}
	});
	let browser: Awaited<ReturnType<typeof launchChromiumOrSkip>>;
	try {
		await build({
			configFile: false,
			root,
			logLevel: 'silent',
			build: {
				outDir: scratch,
				emptyOutDir: true,
				lib: {
					entry: {
						'anti-spoof': join(root, 'src/lib/kiosk/anti-spoof.ts'),
						face: join(root, 'src/lib/kiosk/face.ts')
					},
					formats: ['es'],
					fileName: (_format, name) => `${name}.js`
				}
			}
		});
		for (const name of await readdir(scratch))
			if (name.endsWith('.js')) {
				files.set('/assets/' + name, { path: join(scratch, name), type: 'text/javascript' });
			}
		await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
		const address = server.address();
		assert.ok(address !== null && typeof address !== 'string');
		browser = await launchChromiumOrSkip();
		assert.ok(browser, 'Chromium is required for the anti-spoof model gate');
		const page = await browser.openPage(guestUrlForChromium('127.0.0.1', address.port, '/'));
		const capture = await page.evaluate(`(async () => {
			const {drawVideoFrame,createAnalyseCanvas} = await import('/assets/face.js');
			const source = document.createElement('canvas'); source.width=720; source.height=1280;
			const context=source.getContext('2d'); context.fillStyle='#f00'; context.fillRect(0,0,720,1280);
			context.fillStyle='#0f0'; context.fillRect(0,438,720,404);
			const video=document.createElement('video'); video.muted=true; video.srcObject=source.captureStream(30);
			try {
				await video.play(); const output=createAnalyseCanvas();
				const copied=drawVideoFrame(video,output,{width:390,height:219.375});
				return JSON.stringify({copied,width:output.width,height:output.height,pixel:[...output.getContext('2d').getImageData(10,10,1,1).data]});
			} finally { video.srcObject.getTracks().forEach(track=>track.stop()); }
		})()`);
		assert.deepEqual(
			JSON.parse(String(capture)),
			{ copied: true, width: 640, height: 360, pixel: [0, 255, 0, 255] },
			'portrait camera analysis must match the visible crop without letterboxing or stretching'
		);
		const recognition = await page.evaluate(`(async () => {
      const {warmFaceEngine} = await import('/assets/face.js');
      const image = new Image(); image.src = '/fixtures/image_T1.jpg'; await image.decode();
      const canvas = document.createElement('canvas');
      const samples = [];
      let baseline;
      for (const enrollment of [true, false]) {
        const human = await warmFaceEngine(enrollment);
        try {
          for (const [width,height] of [[480,640],[360,480],[240,320],[960,1280]]) {
            canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(image,0,0,width,height);
            const start = performance.now(); const result = await human.detect(canvas);
            const face = result.face[0];
            if (!face?.embedding?.length) throw new Error('No descriptor at '+width+'x'+height+' enrollment='+enrollment);
            const v = face.embedding; baseline ??= v;
            const dot = v.reduce((s,x,i) => s+x*baseline[i],0);
            const norm = Math.hypot(...v)*Math.hypot(...baseline);
            samples.push({enrollment,width,height,distance:1-dot/norm,detectMs:performance.now()-start,box:face.box});
          }
        } finally { human.reset(); }
      }
      return JSON.stringify(samples);
    })()`);
		const recognitionSamples = JSON.parse(String(recognition)) as {
			enrollment: boolean;
			width: number;
			height: number;
			distance: number;
			detectMs: number;
			box: number[];
		}[];
		await writeFile(
			join(scratchRoot, 'kiosk-recognition-profile.json'),
			JSON.stringify(recognitionSamples, null, 2)
		);
		for (const sample of recognitionSamples)
			assert.ok(sample.distance < 0.25, JSON.stringify(sample));
		const result = await page.evaluate(`(async () => {
      const {loadAntiSpoof, scoreAntiSpoof} = await import('/assets/anti-spoof.js');
      const {warmFaceEngine, unpaddedFaceBox} = await import('/assets/face.js');
      const started = performance.now();
      const session = await loadAntiSpoof();
      const bootMs = performance.now() - started;
      const human = await warmFaceEngine(false);
      const reference = await (await fetch('/fixtures/reference.json')).json();
      const canvas = document.createElement('canvas');
      const crop = document.createElement('canvas'); crop.width = crop.height = 80;
      const samples = []; const timings = [];
      try {
        for (const sample of reference) {
          const image = new Image(); image.src = '/fixtures/' + sample.file; await image.decode();
          canvas.width = image.width; canvas.height = image.height;
          canvas.getContext('2d').drawImage(image, 0, 0);
          const score = await scoreAntiSpoof(session, canvas, sample.box, crop);
          const face = (await human.detect(canvas)).face[0];
          if (!face) throw new Error('No face in '+sample.file);
          const box = unpaddedFaceBox(face.box);
          const detectorScore = await scoreAntiSpoof(session, canvas, box, crop);
          samples.push({file: sample.file, score, detectorScore, box, reference: sample.probabilities[1]});
          for (let i=0; i<10; i++) {
            const start = performance.now();
            await scoreAntiSpoof(session, canvas, sample.box, crop);
            timings.push(performance.now() - start);
          }
        }
      } finally { human.reset(); await session.release(); }
      timings.sort((a,b) => a-b);
      return JSON.stringify({samples, bootMs, medianMs:timings[15], p95Ms:timings[28]});
    })()`);
		assert.equal(typeof result, 'string');
		const measured = JSON.parse(String(result)) as {
			samples: { file: string; score: number; detectorScore: number; reference: number }[];
			bootMs: number;
			medianMs: number;
			p95Ms: number;
		};
		assert.equal(measured.samples.length, 3);
		for (const sample of measured.samples) {
			assert.equal(sample.score >= 0.8, sample.file === 'image_T1.jpg', JSON.stringify(sample));
			assert.equal(
				sample.detectorScore >= 0.8,
				sample.file === 'image_T1.jpg',
				JSON.stringify(sample)
			);
			assert.ok(Math.abs(sample.score - sample.reference) < 0.1, JSON.stringify(sample));
		}
		for (const name of ['minifasnet.onnx', 'ort-wasm-simd-threaded.wasm']) {
			assert.ok(requested.has('/models/minifas/' + name), 'release must supply ' + name);
		}
		console.log('KIOSK_ANTI_SPOOF_PROFILE', JSON.stringify(measured));
		await writeFile(
			join(scratchRoot, 'kiosk-model-profile.json'),
			JSON.stringify(measured, null, 2)
		);
	} finally {
		await browser?.close();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(scratch, { recursive: true, force: true });
	}
});
