<script lang="ts">
	import { Effect } from 'effect';
	import { client } from '../../lib/workspace-client.js';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { meanEmbedding } from '../../lib/kiosk/embed.js';
	import { KIOSK_ENROLL_SAMPLES } from '../../lib/kiosk/config.js';
	import type { KioskSample } from '../../lib/kiosk/sample.js';

	let {
		ondone,
		ensureCamera,
		analyzeSample,
		attachVideo
	}: {
		ondone: () => void;
		ensureCamera: () => Promise<void>;
		analyzeSample: () => Promise<KioskSample | null>;
		attachVideo: (node: HTMLVideoElement) => () => void;
	} = $props();

	type Step = 'capture' | 'identity' | 'review' | 'result';
	let step = $state<Step>('capture');
	let samples = $state<KioskSample[]>([]);
	let capturing = $state(false);
	let captureError = $state<string | null>(null);

	let mode = $state<'existing' | 'neu'>('existing');
	let term = $state('');
	let chosenId = $state<string | null>(null);
	let personName = $state('');
	let personEmail = $state('');
	let personPhone = $state('');
	let personNumber = $state('');
	let companyId = $state<string | null>(null);

	/** Live person matches from two letters; a stale pick drops out as the list narrows. */
	const peopleQuery = $derived(
		mode !== 'existing' || term.trim().length < 2
			? null
			: client.db.employees.findMany({
					search: { mode: 'lexical', term: term.trim() },
					columns: { id: true, name: true, face_enrollment_status: true },
					limit: 20
				})
	);
	const people = $derived(peopleQuery?.current ?? []);
	const chosen = $derived(people.find((person) => person.id === chosenId) ?? null);

	const companiesQuery = $derived(
		mode !== 'neu'
			? null
			: client.db.companies.findMany({ columns: { id: true, name: true }, limit: 100 })
	);
	const companies = $derived(companiesQuery?.current ?? []);

	let consent = $state(false);
	let submitting = $state(false);
	let outcome = $state<string | null>(null);
	let error = $state<string | null>(null);

	const capture = async () => {
		if (samples.length >= KIOSK_ENROLL_SAMPLES) return;
		capturing = true;
		captureError = null;
		try {
			await ensureCamera();
			const sample = await analyzeSample();
			if (sample === null) {
				captureError = 'No face in frame — move closer and face the camera.';
			} else {
				samples = [...samples, sample];
				if (samples.length >= 2) step = 'identity';
			}
		} catch (failure) {
			captureError = failure instanceof Error ? failure.message : String(failure);
		} finally {
			capturing = false;
		}
	};

	const canReview = $derived(
		samples.length >= 1 &&
			(mode === 'existing' ? chosen !== null : personName.trim().length > 0 && companyId !== null)
	);

	const canvasToFile = (canvas: HTMLCanvasElement): Promise<File> =>
		new Promise((resolve, reject) => {
			canvas.toBlob(
				(blob) => {
					if (blob === null) reject(new Error('Snapshot encoding failed.'));
					else resolve(new File([blob], 'face.jpg', { type: 'image/jpeg' }));
				},
				'image/jpeg',
				0.8
			);
		});

	const submit = async () => {
		if (!canReview || !consent || samples.length === 0) return;
		submitting = true;
		error = null;
		try {
			const vector = meanEmbedding(samples.map((sample) => sample.vector));
			const uploadClient = getDataRendererRuntimeContext()?.createFileUploadClient();
			if (uploadClient === undefined) throw new Error('File upload is unavailable in this shell.');
			const uploaded = await Effect.runPromise(
				uploadClient.upload(await canvasToFile(samples[0]!.canvas))
			);
			const consentAt = new Date().toISOString();
			if (mode === 'existing' && chosenId !== null) {
				const result = await client.invoke.kiosk_enroll({
					employee_id: chosenId,
					face_embedding: vector,
					face_photo: {
						storage_key: uploaded.storageKey,
						file_name: uploaded.name,
						file_size: uploaded.size,
						mime_type: uploaded.type
					},
					consent_at: consentAt
				});
				outcome = `Face enrolled and approved for this person. (${result.employee_id})`;
			} else if (mode === 'neu' && companyId !== null) {
				const result = await client.invoke.kiosk_enroll({
					new_person: {
						name: personName.trim(),
						...(personEmail.trim() === '' ? {} : { email: personEmail.trim() }),
						...(personPhone.trim() === '' ? {} : { phone: personPhone.trim() }),
						company_id: companyId,
						...(personNumber.trim() === '' ? {} : { employee_number: personNumber.trim() })
					},
					face_embedding: vector,
					face_photo: {
						storage_key: uploaded.storageKey,
						file_name: uploaded.name,
						file_size: uploaded.size,
						mime_type: uploaded.type
					},
					consent_at: consentAt
				});
				outcome = `Person created — pending HR review before this face can punch. (${result.employee_id})`;
			}
			step = 'result';
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			submitting = false;
		}
	};

	const restart = () => {
		samples = [];
		chosenId = null;
		consent = false;
		outcome = null;
		error = null;
		step = 'capture';
	};
</script>

<div class="flex max-w-2xl flex-col gap-2 p-4">
	<h2 class="text-lg font-bold">Enroll face</h2>
	{#if step === 'capture'}
		<p>Capture {KIOSK_ENROLL_SAMPLES} angles of one face (two is enough to continue).</p>
		<video {@attach attachVideo} playsinline autoplay muted class="w-[min(480px,90vw)] rounded-lg"
		></video>
		<div class="flex flex-wrap items-center gap-2">
			<button
				onclick={() => void capture()}
				disabled={capturing || samples.length >= KIOSK_ENROLL_SAMPLES}
			>
				{capturing ? 'Reading face…' : `Capture (${samples.length}/${KIOSK_ENROLL_SAMPLES})`}
			</button>
			{#if samples.length >= 1}
				<button onclick={() => (step = 'identity')}>Continue</button>
			{/if}
		</div>
		{#if captureError !== null}<p role="alert" class="text-sm text-destructive">
				{captureError}
			</p>{/if}
		<div class="flex flex-wrap items-center gap-2">
			{#each samples as sample, i (i)}
				<figure>
					<img class="w-40 rounded" src={sample.dataUrl} alt="capture {i + 1}" />
					<figcaption class="text-xs">score {sample.score} · {sample.ms}ms</figcaption>
				</figure>
			{/each}
		</div>
	{:else if step === 'identity'}
		<div class="flex flex-wrap items-center gap-2">
			<button aria-pressed={mode === 'existing'} onclick={() => (mode = 'existing')}
				>Known person</button
			>
			<button aria-pressed={mode === 'neu'} onclick={() => (mode = 'neu')}>New person</button>
		</div>
		{#if mode === 'existing'}
			<input type="search" placeholder="Name (min 2 letters)" bind:value={term} />
			{#if peopleQuery?.error}<p role="alert" class="text-sm text-destructive">
					{peopleQuery.error.message}
				</p>{/if}
			<ul>
				{#each people as person (person.id)}
					<li>
						<button
							class:outline-2={chosenId === person.id}
							disabled={person.face_enrollment_status !== 'NONE'}
							onclick={() => (chosenId = person.id)}
						>
							{person.name} · {person.face_enrollment_status === 'NONE'
								? 'no face yet'
								: person.face_enrollment_status.toLowerCase()}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<label class="flex flex-col gap-1">Name* <input bind:value={personName} /></label>
			<label class="flex flex-col gap-1"
				>Email <input bind:value={personEmail} inputmode="email" /></label
			>
			<label class="flex flex-col gap-1"
				>Phone <input bind:value={personPhone} inputmode="tel" /></label
			>
			<label class="flex flex-col gap-1"
				>Employee no. <input bind:value={personNumber} placeholder="auto if empty" /></label
			>
			<label
				>Company*
				<select bind:value={companyId}>
					<option value={null}>—</option>
					{#each companies as company (company.id)}
						<option value={company.id}>{company.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		<div class="flex flex-wrap items-center gap-2">
			<button onclick={() => (step = 'capture')}>Back</button>
			<button onclick={() => (step = 'review')} disabled={!canReview}>Review</button>
		</div>
	{:else if step === 'review'}
		<p>
			{samples.length} capture(s) → one averaged descriptor. The person consents to face clocking:
		</p>
		<label><input type="checkbox" bind:checked={consent} /> Consent recorded</label>
		{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		<div class="flex flex-wrap items-center gap-2">
			<button onclick={() => (step = 'identity')}>Back</button>
			<button onclick={() => void submit()} disabled={submitting || !consent}>
				{submitting ? 'Enrolling…' : 'Enroll'}
			</button>
		</div>
	{:else}
		<p role="status" class="font-bold">{outcome}</p>
		<div class="flex flex-wrap items-center gap-2">
			<button onclick={restart}>Enroll another</button>
			<button onclick={ondone}>Back to clock</button>
		</div>
	{/if}
</div>
