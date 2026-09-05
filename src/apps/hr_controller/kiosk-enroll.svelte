<script lang="ts">
	import { Effect } from 'effect';
	import Icon from '@iconify/svelte';
	import { Button } from '@norbital-ai/ui/button';
	import { client } from '../../lib/workspace-client.js';
	import { CollectionForm, type CollectionFormSemantic } from '@norbital-ai/ui/collection-form';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { Input } from '@norbital-ai/ui/input';
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
	/**
	 * In-flight and failure of the work the form does NOT own: the new-person `kiosk_enroll`
	 * command, and the photo upload that precedes the existing-person native submit. The native
	 * submit itself — settling, approval-waiting, failure — is framework-owned.
	 */
	let submitting = $state(false);
	let outcome = $state<string | null>(null);
	let error = $state<string | null>(null);

	/**
	 * The form remounts when its record identity changes: a different chosen person is a different
	 * update, and switching branches is a create instead of one. Samples and identity typing live
	 * outside the form and survive the remount, exactly as they survived a pick change before.
	 */
	const enrollKey = $derived(`${mode}:${mode === 'existing' ? (chosenId ?? 'none') : 'new'}`);
	const enrollDefaults = $derived(
		mode === 'existing' && chosenId != null ? { id: chosenId } : undefined
	);

	/**
	 * The framework footer beside the Enroll button must never be a second write path. A new
	 * person is created by the command below, never by a native submit; an existing person's
	 * native submit only runs after the Enroll button prepared embedding, photo, consent and
	 * approval into the form.
	 */
	const enrollSemantic: CollectionFormSemantic = (values) =>
		Effect.sync(() => {
			if (mode !== 'existing' || chosenId == null)
				return [
					{
						message:
							'Use the Enroll button to create the person — this form only updates the chosen record.'
					}
				];
			if (!consent) return [{ message: 'Record the person’s consent before enrolling.' }];
			if (!Array.isArray(values.face_embedding) || values.face_photo == null)
				return [{ message: 'Capture the face before enrolling.' }];
			return;
		});

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

	const restart = () => {
		samples = [];
		chosenId = null;
		consent = false;
		outcome = null;
		error = null;
		step = 'capture';
	};
</script>

<div class="mx-auto w-full max-w-4xl p-4 sm:p-8">
	<section class="rounded-xl border bg-card p-5 sm:p-7">
		<header class="mb-6 flex items-start gap-4 border-b pb-5">
			<div class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted">
				<Icon icon="lucide:user-round-plus" class="size-5" />
			</div>
			<div>
				<h1 class="text-section">Enroll face</h1>
				<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
					Capture a live face, identify the person, and record their consent.
				</p>
			</div>
		</header>
		<ol class="mb-6 grid grid-cols-4 gap-2" aria-label="Enrollment progress">
			{#each ['Capture', 'Identity', 'Review', 'Done'] as label, index}
				<li
					class="border-t-2 pt-2 text-meta {index <=
					(['capture', 'identity', 'review', 'result'] as Step[]).indexOf(step)
						? 'border-primary text-foreground'
						: 'border-border'}"
				>
					{label}
				</li>
			{/each}
		</ol>
		<!--
		ONE form over `employees` wrapping every step. Every Field stays mounted on every step —
		steps hide with the `hidden` attribute, never an `{#if}` — because the framework asserts
		complete field registration on mount and on submit. Identity typing and the company pick
		are plain `$state` (the new-person command reads them, not the form); the three employee
		columns they fill ride hidden Fields fed by `setValues` as they are typed.
	-->
		{#key enrollKey}
			<CollectionForm
				{client}
				collection="employees"
				defaultValues={enrollDefaults}
				semantic={enrollSemantic}
				onAfterSubmit={() => {
					outcome = 'Face registration saved.';
					step = 'result';
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
					<div hidden={step !== 'capture'} class="space-y-5">
						<p class="text-sm text-muted-foreground">
							Capture {KIOSK_ENROLL_SAMPLES} angles of one face. One clear capture is enough to continue.
						</p>
						<video
							{@attach attachVideo}
							playsinline
							autoplay
							muted
							class="aspect-video w-full max-w-2xl -scale-x-100 rounded-xl bg-foreground object-cover"
						></video>
						<div class="flex flex-wrap items-center gap-2">
							<Button
								onclick={() => void capture()}
								disabled={capturing || samples.length >= KIOSK_ENROLL_SAMPLES}
							>
								<Icon
									icon={capturing ? 'lucide:loader-circle' : 'lucide:camera'}
									class="size-4 {capturing ? 'animate-spin' : ''}"
								/>
								{capturing
									? 'Reading face…'
									: `Capture (${samples.length}/${KIOSK_ENROLL_SAMPLES})`}
							</Button>
							{#if samples.length >= 1}
								<Button variant="secondary" onclick={() => (step = 'identity')}>
									Continue
									<Icon icon="lucide:arrow-right" class="size-4" />
								</Button>
							{/if}
						</div>
						{#if captureError !== null}<p role="alert" class="text-sm text-destructive">
								{captureError}
							</p>{/if}
						<div class="flex flex-wrap items-center gap-3">
							{#each samples as sample, i (i)}
								<figure class="overflow-hidden rounded-lg border bg-background">
									<img
										class="aspect-video w-40 object-cover"
										src={sample.dataUrl}
										alt="capture {i + 1}"
									/>
									<figcaption class="px-2 py-1.5 font-mono text-meta">
										score {sample.score} · {sample.ms}ms
									</figcaption>
								</figure>
							{/each}
						</div>
					</div>
					<div hidden={step !== 'identity'} class="space-y-5">
						<div class="flex flex-wrap items-center gap-2">
							<Button
								variant={mode === 'existing' ? 'secondary' : 'ghost'}
								aria-pressed={mode === 'existing'}
								onclick={() => (mode = 'existing')}>Known person</Button
							>
							<Button
								variant={mode === 'neu' ? 'secondary' : 'ghost'}
								aria-pressed={mode === 'neu'}
								onclick={() => (mode = 'neu')}>New person</Button
							>
						</div>
						{#if mode === 'existing'}
							<Input type="search" placeholder="Search by name" bind:value={term} />
							{#if peopleQuery?.error}<p role="alert" class="text-sm text-destructive">
									{peopleQuery.error.message}
								</p>{/if}
							<ul class="divide-y overflow-hidden rounded-lg border">
								{#each people as person (person.id)}
									<li>
										<button
											type="button"
											aria-pressed={chosenId === person.id}
											class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring {chosenId ===
											person.id
												? 'bg-muted'
												: ''}"
											disabled={person.face_enrollment_status === 'PENDING' ||
												person.face_enrollment_status === 'SUSPENDED'}
											onclick={() => (chosenId = person.id)}
										>
											<span>{person.name}</span>
											<span class="text-meta"
												>{person.face_enrollment_status === 'NONE'
													? 'No face yet'
													: person.face_enrollment_status.toLowerCase()}</span
											>
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<div class="grid gap-4 sm:grid-cols-2">
								<label class="flex flex-col gap-2 text-label"
									>Name* <Input
										value={personName}
										oninput={(event) => {
											personName = event.currentTarget.value;
											form.setValues({ name: personName });
										}}
									/></label
								>
								<label class="flex flex-col gap-2 text-label"
									>Email <Input
										value={personEmail}
										inputmode="email"
										oninput={(event) => {
											personEmail = event.currentTarget.value;
											form.setValues({ email: personEmail });
										}}
									/></label
								>
								<label class="flex flex-col gap-2 text-label"
									>Phone <Input
										value={personPhone}
										inputmode="tel"
										oninput={(event) => {
											personPhone = event.currentTarget.value;
											form.setValues({ phone: personPhone });
										}}
									/></label
								>
								<label class="flex flex-col gap-2 text-label"
									>Employee no. <Input
										bind:value={personNumber}
										placeholder="Generated if empty"
									/></label
								>
								<label class="flex flex-col gap-2 text-label"
									>Company*
									<select
										class="h-8 rounded-sm border border-input bg-background px-3 text-sm"
										bind:value={companyId}
									>
										<option value={null}>—</option>
										{#each companies as company (company.id)}
											<option value={company.id}>{company.name}</option>
										{/each}
									</select>
								</label>
							</div>
						{/if}
						<div class="flex flex-wrap items-center justify-between gap-2 border-t pt-5">
							<Button variant="ghost" onclick={() => (step = 'capture')}>Back</Button>
							<Button onclick={() => (step = 'review')} disabled={!canReview}>Review</Button>
						</div>
					</div>
					<div hidden={step !== 'review'} class="space-y-5">
						<p class="text-sm text-muted-foreground">
							{samples.length} capture(s) → one averaged descriptor. The person consents to face clocking:
						</p>
						<label
							class="flex items-center gap-3 rounded-lg border bg-background p-4 text-sm font-medium"
							><input class="size-4" type="checkbox" bind:checked={consent} /> Consent recorded</label
						>
						{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
						<div class="flex flex-wrap items-center justify-between gap-2 border-t pt-5">
							<Button variant="ghost" onclick={() => (step = 'identity')}>Back</Button>
							<Button
								onclick={async (event) => {
									if (!canReview || !consent || samples.length === 0) return;
									const button = event.currentTarget;
									submitting = true;
									error = null;
									try {
										const vector = meanEmbedding(samples.map((sample) => sample.vector));
										const uploadClient = getDataRendererRuntimeContext()?.createFileUploadClient();
										if (uploadClient === undefined)
											throw new Error('File upload is unavailable in this shell.');
										const uploaded = await Effect.runPromise(
											uploadClient.upload(await canvasToFile(samples[0]!.canvas))
										);
										const consentAt = new Date().toISOString();
										if (mode === 'neu' || chosenId == null) {
											// A new person is two rows — the employee PENDING plus their employment —
											// so it stays a `kiosk_enroll` command, exactly as before.
											if (companyId == null) return;
											const result = await client.invoke.kiosk_enroll({
												new_person: {
													name: personName.trim(),
													...(personEmail.trim() === '' ? {} : { email: personEmail.trim() }),
													...(personPhone.trim() === '' ? {} : { phone: personPhone.trim() }),
													company_id: companyId,
													...(personNumber.trim() === ''
														? {}
														: { employee_number: personNumber.trim() })
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
											step = 'result';
											return;
										}
										// A known person is one row: prepare the capture into the form, then take
										// the native submit. The button cannot be `type="submit"` — the upload
										// must finish before the values it produces are read.
										form.setValues({
											face_embedding: vector,
											face_photo: {
												storage_key: uploaded.storageKey,
												file_name: uploaded.name,
												file_size: uploaded.size,
												mime_type: uploaded.type
											},
											face_consent_at: consentAt,
											face_enrolled_at: consentAt,
											face_enrollment_status: 'APPROVED'
										});
										if (button instanceof HTMLButtonElement) button.form?.requestSubmit();
									} catch (failure) {
										error = failure instanceof Error ? failure.message : String(failure);
									} finally {
										submitting = false;
									}
								}}
								disabled={submitting || !consent}
							>
								{submitting ? 'Enrolling…' : 'Enroll'}
							</Button>
						</div>
					</div>
					<div hidden={step !== 'result'} class="space-y-5">
						<div
							class="flex items-start gap-3 rounded-lg bg-success/10 p-4 text-success"
							role="status"
						>
							<Icon icon="lucide:circle-check" class="mt-0.5 size-5 shrink-0" />
							<p class="text-sm font-medium">{outcome}</p>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<Button onclick={restart}>Enroll another</Button>
							<Button variant="ghost" onclick={ondone}>Back to clock</Button>
						</div>
					</div>
				{/snippet}
			</CollectionForm>
		{/key}
	</section>
</div>
