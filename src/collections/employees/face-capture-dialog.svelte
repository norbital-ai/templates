<script lang="ts">
	import { onMount } from 'svelte';
	import { Effect } from 'effect';
	import type Human from '@vladmandic/human';
	import { client } from '../../lib/workspace-client.js';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import { Stack } from '@norbital-ai/ui/layout';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import {
		createAnalyseCanvas,
		extractFaceSample,
		showStream,
		warmFaceEngine
	} from '../../lib/kiosk/face.js';
	import type { KioskSample } from '../../lib/kiosk/sample.js';

	let {
		open = $bindable(false),
		employeeId,
		employeeName,
		currentStatus,
		onsaved
	}: {
		open: boolean;
		employeeId: string;
		employeeName: string;
		currentStatus: string;
		onsaved: (previewUrl: string) => void;
	} = $props();

	let videoNode: HTMLVideoElement | null = null;
	let stream: MediaStream | null = null;
	let engine: Human | null = null;
	let enginePromise: Promise<Human> | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let ready = $state(false);
	let warming = $state(false);
	let capturing = $state(false);
	let saving = $state(false);
	let sample = $state<KioskSample | null>(null);
	let error = $state<string | null>(null);

	const stopCamera = () => {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
	};

	/** Same two-direction attach as the kiosk: content mounts after open flips. */
	const attachVideo = (node: HTMLVideoElement) => {
		videoNode = node;
		if (stream !== null) showStream(node, stream);
		return () => {
			if (videoNode === node) videoNode = null;
		};
	};

	const start = async () => {
		sample = null;
		error = null;
		warming = true;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: 'user',
					width: { ideal: 1280 },
					height: { ideal: 720 }
				},
				audio: false
			});
			if (videoNode !== null) showStream(videoNode, stream);
			enginePromise ??= warmFaceEngine();
			engine = await enginePromise;
			canvas ??= createAnalyseCanvas();
			ready = engine !== null && canvas !== null;
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			warming = false;
		}
	};

	const opened = (isOpen: boolean) => {
		if (isOpen) void start();
		else {
			stopCamera();
			sample = null;
			error = null;
		}
	};

	const capture = async () => {
		if (engine === null || canvas === null || videoNode === null || capturing) return;
		capturing = true;
		error = null;
		try {
			const next = await extractFaceSample(engine, videoNode, canvas);
			if (next === null) error = 'No face in frame — move closer and face the camera.';
			else sample = next;
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			capturing = false;
		}
	};

	const snapshotFile = async (): Promise<File | null> => {
		if (sample === null) return null;
		const blob = await new Promise<Blob | null>((resolve) =>
			sample?.canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.8)
		);
		return blob === null ? null : new File([blob], 'face.jpg', { type: 'image/jpeg' });
	};

	const save = async () => {
		if (sample === null || saving) return;
		saving = true;
		error = null;
		try {
			const vector = [...sample.vector];
			const previewUrl = sample.dataUrl;
			const uploadClient = getDataRendererRuntimeContext()?.createFileUploadClient();
			const file = await snapshotFile();
			const photo =
				uploadClient === undefined || file === null
					? undefined
					: await Effect.runPromise(uploadClient.upload(file)).then((uploaded) => ({
							storage_key: uploaded.storageKey,
							file_name: uploaded.name,
							file_size: uploaded.size,
							mime_type: uploaded.type
						}));
			const consentAt = new Date().toISOString();
			if (currentStatus === 'NONE') {
				await client.invoke.kiosk_enroll({
					employee_id: employeeId,
					face_embedding: vector,
					...(photo === undefined ? {} : { face_photo: photo }),
					consent_at: consentAt
				});
			} else {
				await Effect.runPromise(
					submitCollectionMutation(() =>
						client.db.employees.mutate([
							{
								id: employeeId,
								face_embedding: vector,
								...(photo === undefined ? {} : { face_photo: photo }),
								face_consent_at: consentAt,
								face_enrolled_at: consentAt
							}
						])
					)
				);
			}
			open = false;
			onsaved(previewUrl);
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			saving = false;
		}
	};

	/** Navigating away with the dialog open releases the camera and the engine. */
	onMount(() => () => {
		stopCamera();
		engine?.reset();
	});
</script>

<Dialog.Root bind:open onOpenChange={opened}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Capture face photo</Dialog.Title>
			<Dialog.Description>
				{employeeName} — face the camera, then capture. You can re-capture before saving.
			</Dialog.Description>
		</Dialog.Header>
		{#if warming}
			<Stack align="center" justify="center" gap="sm" class="py-10">
				<Spinner class="size-8" label="Preparing camera" />
				<p role="status" class="text-sm text-muted-foreground">Getting ready…</p>
			</Stack>
		{:else if sample !== null}
			<Stack gap="sm" align="center">
				<img class="w-full max-w-md rounded-lg" src={sample.dataUrl} alt="captured face" />
				<p class="text-xs text-muted-foreground">face score {sample.score}</p>
			</Stack>
		{:else}
			<Stack gap="sm" align="center">
				<video
					{@attach attachVideo}
					playsinline
					autoplay
					muted
					class="w-full max-w-md rounded-lg bg-muted"
				></video>
				<button onclick={() => void capture()} disabled={capturing || !ready}>
					{capturing ? 'Reading face…' : 'Capture'}
				</button>
			</Stack>
		{/if}
		{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		<Dialog.Footer>
			<Dialog.Close disabled={saving}>Cancel</Dialog.Close>
			{#if sample !== null}
				<button
					onclick={() => {
						sample = null;
					}}
					disabled={saving}>Re-capture</button
				>
				<button onclick={() => void save()} disabled={saving}>
					{saving ? 'Saving…' : 'Save photo'}
				</button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
