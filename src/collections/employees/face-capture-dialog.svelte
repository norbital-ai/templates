<script lang="ts">
	import { onMount } from 'svelte';
	import { Effect } from 'effect';
	import type Human from '@vladmandic/human';
	import { client } from '../../lib/workspace-client.js';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import { Stack } from '@norbital-ai/ui/layout';
	import {
		CollectionForm,
		type CollectionFormController,
		type CollectionFormSemantic
	} from '@norbital-ai/ui/collection-form';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import {
		createAnalyseCanvas,
		extractFaceSample,
		showStream,
		warmFaceEngine
	} from '../../lib/kiosk/face.js';
	import type { KioskSample } from '../../lib/kiosk/sample.js';
	import type { WorkspaceRow } from '$bolt/client';

	let {
		open = $bindable(false),
		record,
		onsaved
	}: {
		open: boolean;
		record: WorkspaceRow<'employees'>;
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
	/**
	 * In-flight and failure of the first-enrollment command only. The re-capture below goes
	 * through the form, whose settling and failure are framework-owned.
	 */
	let saving = $state(false);
	let sample = $state<KioskSample | null>(null);
	let error = $state<string | null>(null);
	/** The preview the form's `onAfterSubmit` hands back; read at submit time, not render time. */
	let savedPreviewUrl: string | null = null;

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

	/** The re-capture writes the capture the dialog holds — nothing else may submit it. */
	const recaptureSemantic: CollectionFormSemantic = (values) =>
		Effect.sync(() => {
			if (!Array.isArray(values.face_embedding))
				return [{ message: 'Capture the face before saving.' }];
			return;
		});

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
				{record.name} — face the camera, then capture. You can re-capture before saving.
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
		{#if record.face_enrollment_status === 'NONE'}
			<!--
 				First enrollment stays an inline `kiosk_enroll` command: the transition into the
 				enrolled lifecycle is enforced there, and it stays there — not in the form below.
 			-->
			<Dialog.Footer>
				<Dialog.Close disabled={saving}>Cancel</Dialog.Close>
				{#if sample !== null}
					<button
						onclick={() => {
							sample = null;
						}}
						disabled={saving}>Re-capture</button
					>
					<button
						onclick={async () => {
							const captured = sample;
							if (captured === null || saving) return;
							saving = true;
							error = null;
							try {
								const vector = [...captured.vector];
								const previewUrl = captured.dataUrl;
								const uploadClient = getDataRendererRuntimeContext()?.createFileUploadClient();
								const blob = await new Promise<Blob | null>((resolve) =>
									captured.canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.8)
								);
								const photo =
									uploadClient === undefined || blob === null
										? undefined
										: await Effect.runPromise(
												uploadClient.upload(new File([blob], 'face.jpg', { type: 'image/jpeg' }))
											).then((uploaded) => ({
												storage_key: uploaded.storageKey,
												file_name: uploaded.name,
												file_size: uploaded.size,
												mime_type: uploaded.type
											}));
								const consentAt = new Date().toISOString();
								if (record.face_enrollment_status !== 'NONE') {
									error = 'This person already has a face enrollment; HR owns changes to it.';
									return;
								}
								await client.invoke.kiosk_enroll({
									employee_id: record.id,
									face_embedding: vector,
									...(photo === undefined ? {} : { face_photo: photo }),
									consent_at: consentAt
								});
								open = false;
								onsaved(previewUrl);
							} catch (failure) {
								error = failure instanceof Error ? failure.message : String(failure);
							} finally {
								saving = false;
							}
						}}
						disabled={saving}
					>
						{saving ? 'Saving…' : 'Save photo'}
					</button>
				{/if}
			</Dialog.Footer>
		{:else}
			<!--
 				Re-capture is one row's face columns, so it is the form's own default write. The
 				photo upload precedes the native submit — the button prepares capture, consent and
 				photo into hidden fields, then requests the submit — because a `type="submit"`
 				button would submit before the upload it must carry finishes.
 			-->
			<CollectionForm
				{client}
				collection="employees"
				defaultValues={record}
				semantic={recaptureSemantic}
				onAfterSubmit={() => {
					open = false;
					if (savedPreviewUrl !== null) onsaved(savedPreviewUrl);
				}}
			>
				{#snippet children({ Field, form })}
					<Field name="name" hidden />
					<Field name="date_of_birth" hidden />
					<Field name="gender" hidden />
					<Field name="marital_status" hidden />
					<Field name="spouse_status" hidden />
					<Field name="nationality" hidden />
					<Field name="identity_number" hidden />
					<Field name="dependents_count" hidden />
					<Field name="email" hidden />
					<Field name="phone" hidden />
					<Field name="address" hidden />
					<Field name="user_id" hidden />
					<Field name="face_embedding" hidden />
					<Field name="face_photo" hidden />
					<Field name="face_enrollment_status" hidden />
					<Field name="face_consent_at" hidden />
					<Field name="face_enrolled_at" hidden />
					<Field name="face_last_match_at" hidden />
					<Field name="face_match_count" hidden />
					<Dialog.Footer>
						<button
							type="button"
							disabled={saving}
							onclick={() => {
								open = false;
							}}>Cancel</button
						>
						{#if sample !== null}
							<button
								type="button"
								disabled={saving}
								onclick={() => {
									sample = null;
								}}>Re-capture</button
							>
							<button
								type="button"
								disabled={saving}
								onclick={async (event) => {
									const captured = sample;
									if (captured === null || saving) return;
									const button = event.currentTarget;
									saving = true;
									error = null;
									try {
										const vector = [...captured.vector];
										savedPreviewUrl = captured.dataUrl;
										const uploadClient = getDataRendererRuntimeContext()?.createFileUploadClient();
										const blob = await new Promise<Blob | null>((resolve) =>
											captured.canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.8)
										);
										const photo =
											uploadClient === undefined || blob === null
												? undefined
												: await Effect.runPromise(
														uploadClient.upload(
															new File([blob], 'face.jpg', { type: 'image/jpeg' })
														)
													).then((uploaded) => ({
														storage_key: uploaded.storageKey,
														file_name: uploaded.name,
														file_size: uploaded.size,
														mime_type: uploaded.type
													}));
										const consentAt = new Date().toISOString();
										form.setValues({
											face_embedding: vector,
											...(photo === undefined ? {} : { face_photo: photo }),
											face_consent_at: consentAt,
											face_enrolled_at: consentAt
										});
										button.form?.requestSubmit();
									} catch (failure) {
										error = failure instanceof Error ? failure.message : String(failure);
									} finally {
										saving = false;
									}
								}}
							>
								{saving ? 'Saving…' : 'Save photo'}
							</button>
						{/if}
					</Dialog.Footer>
				{/snippet}
			</CollectionForm>
		{/if}
	</Dialog.Content>
</Dialog.Root>
