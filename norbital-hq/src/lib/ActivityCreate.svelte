<script lang="ts">
	/**
	 * Typed-union activity creation flow:
	 * 1. Choose the activity type (`Recording`, `Manual notes`, or `Scheduled meeting`).
	 * 2. Show only that type's tailored form, with persistent pause/resume local audio capture
	 *    and multi-file audio upload for recordings (creating `meeting_recordings` child entities).
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { id_of, type Id } from '@norbital-ai/bolt';
	import type { FormProps, InsertOf } from '@norbital-ai/ui';
	import { attach, fork } from '@norbital-ai/ui/effect';
	import { Duration, Effect, Option, Schema, Scope } from 'effect';
	import {
		Alert,
		Button,
		Field,
		Form,
		Icon,
		Section,
		format,
		notify_outcome,
		open_record
	} from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import type { ActivityKindChoice } from './activity-create.js';
	import { captureMeetingAudio } from './meeting-capture.js';
	import {
		buildRecordingFile,
		clearRecordingDraft,
		loadRecordingDraft,
		saveRecordingDraft,
		type PersistedRecording
	} from './recording-store.js';

	type Outcome = Parameters<NonNullable<FormProps['on_outcome']>>[0];

	let {
		ctx,
		values = {},
		initial = undefined,
		on_done
	}: {
		ctx: PageContext;
		values?: Partial<InsertOf<'activities'>>;
		initial?: ActivityKindChoice | undefined;
		on_done?: (outcome: Outcome) => void;
	} = $props();

	const t = ctx.t;
	const storageKey = $derived(
		`create:${values.company ?? 'global'}:${values.project_id ?? 'none'}`
	);
	let choice = $state<ActivityKindChoice | null>(null);
	$effect.pre(() => {
		if (initial !== undefined && choice === null) choice = initial;
	});

	let owner = $state.raw<Scope.Scope | undefined>(undefined);
	const lifetime = attach(() =>
		Effect.gen(function* () {
			owner = yield* Scope.Scope;
			yield* Effect.never;
		}).pipe(Effect.ensuring(Effect.sync(() => (owner = undefined))))
	);

	let recorder = $state<MediaRecorder | null>(null);
	let paused = $state(false);
	let seconds = $state(0);
	let busy = $state<'starting' | 'saving' | null>(null);
	let problem = $state<string | null>(null);
	let savedDraft = $state<PersistedRecording | null>(null);
	let queuedFiles = $state<File[]>([]);
	let fileInput = $state<HTMLInputElement | null>(null);
	let activeParts: Blob[] = [];
	let activeMime = '';
	let startedAtIso = '';

	$effect(() => {
		const key = storageKey;
		void loadRecordingDraft(key).then((found) => {
			if (storageKey === key) savedDraft = found;
		});
	});

	const formatDuration = (secs: number) =>
		new Intl.DurationFormat(ctx.locale, { style: 'digital', hoursDisplay: 'auto' }).format(
			Duration.parts(Duration.seconds(secs))
		);

	async function persistCurrent(extraSegments: readonly (readonly Blob[])[] = []) {
		const segments = [...extraSegments, ...(activeParts.length > 0 ? [activeParts] : [])];
		if (segments.length === 0) return;
		const draft: PersistedRecording = {
			key: storageKey,
			startedAt: startedAtIso || new Date().toISOString(),
			elapsedSeconds: seconds,
			mimeType: activeMime || savedDraft?.mimeType || 'audio/webm',
			segments,
			updatedAt: new Date().toISOString()
		};
		savedDraft = draft;
		await saveRecordingDraft(draft);
	}

	function startCapture(existing: PersistedRecording | null = null) {
		if (owner === undefined || busy !== null || recorder !== null) return;
		problem = null;
		busy = 'starting';
		const priorSegments = existing?.segments ?? [];
		const baseSeconds = existing?.elapsedSeconds ?? 0;
		startedAtIso = existing?.startedAt ?? new Date().toISOString();
		activeParts = [];
		activeMime = existing?.mimeType ?? '';

		const capture = captureMeetingAudio({
			denied: t('meetings.mic_denied'),
			ready: (next) => {
				seconds = baseSeconds;
				paused = false;
				recorder = next;
				activeMime = next.mimeType || activeMime || 'audio/webm';
				busy = null;
			},
			tick: () => {
				seconds += 1;
			},
			chunk: (part) => {
				activeParts.push(part);
				void persistCurrent(priorSegments);
			}
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					recorder = null;
					paused = false;
					busy = null;
				})
			)
		);

		const operation = Effect.fn('ActivityCreate.recordCapture')(function* () {
			const audio = yield* capture;
			activeMime = audio.mimeType || activeMime;
			if (audio.parts.length > 0) activeParts = [...audio.parts];
			yield* Effect.promise(() => persistCurrent(priorSegments));
		})();

		fork(
			operation.pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						problem = error.message;
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						busy = null;
					})
				),
				Effect.forkIn(owner)
			)
		);
	}

	function pauseCapture() {
		if (recorder === null) return;
		if (recorder.state === 'recording') {
			recorder.pause();
			paused = true;
			void persistCurrent(savedDraft?.segments.slice(0, -1) ?? []);
		}
	}

	function resumeCapture() {
		if (recorder !== null && recorder.state === 'paused') {
			recorder.resume();
			paused = false;
			return;
		}
		if (recorder === null && savedDraft !== null) {
			startCapture(savedDraft);
		}
	}

	async function discardCapture() {
		if (recorder !== null && recorder.state !== 'inactive') {
			recorder.stop();
		}
		activeParts = [];
		seconds = 0;
		paused = false;
		savedDraft = null;
		await clearRecordingDraft(storageKey);
	}

	async function uploadRecordingsForActivity(activityId: Id<'activities'>, files: readonly File[]) {
		if (files.length === 0) return;
		await new Promise<void>((resolve, reject) => {
			fork(
				Effect.gen(function* () {
					const uploaded = yield* Effect.all(
						files.map((file) =>
							ctx
								.upload(file, 'meeting_recordings.audio')
								.pipe(Effect.map((audio) => ({ meeting: activityId, title: file.name, audio })))
						),
						{ concurrency: 2 }
					);
					yield* ctx.act({ 'meeting_recordings.create': uploaded });
				}).pipe(
					Effect.tap(() => Effect.sync(() => resolve())),
					Effect.catch((err) => Effect.sync(() => reject(err)))
				)
			);
		});
	}

	async function saveRecordedDraft(formValues: Record<string, unknown>) {
		if (owner === undefined || busy !== null) return;
		problem = null;
		busy = 'saving';
		try {
			if (recorder !== null && recorder.state !== 'inactive') {
				const active = recorder;
				await new Promise<void>((resolve) => {
					const prev = active.onstop;
					active.onstop = (ev) => {
						prev?.call(active, ev);
						resolve();
					};
					active.stop();
				});
			}
			const draft =
				savedDraft ??
				(activeParts.length > 0
					? {
							key: storageKey,
							startedAt: startedAtIso || new Date().toISOString(),
							elapsedSeconds: seconds,
							mimeType: activeMime || 'audio/webm',
							segments: [activeParts],
							updatedAt: new Date().toISOString()
						}
					: null);
			if (draft === null) return;
			const file = await buildRecordingFile(draft, 'recording');
			const allFiles = [file, ...queuedFiles];
			const outcome = await new Promise<Outcome>((resolve, reject) => {
				fork(
					Effect.gen(function* () {
						const at =
							typeof formValues['occurred_at'] === 'string' && formValues['occurred_at'] !== ''
								? formValues['occurred_at']
								: draft.startedAt;
						const subject =
							typeof formValues['subject'] === 'string' && formValues['subject'].trim() !== ''
								? formValues['subject'].trim()
								: t('meetings.recorded_subject', {
										at: format({ kind: 'instant' }, at, { locale: ctx.locale })
									});
						const detail =
							typeof formValues['detail'] === 'string' && formValues['detail'].trim() !== ''
								? formValues['detail']
								: null;
						const contact_id = Option.getOrNull(
							Schema.decodeUnknownOption(id_of('contacts'))(formValues['contact_id'])
						);
						const created = yield* ctx.act({
							'activities.create': [
								{
									...values,
									kind: 'recording',
									subject,
									occurred_at: at,
									...(contact_id !== null ? { contact_id } : {}),
									...(detail !== null ? { detail } : {})
								}
							]
						});
						if (created.kind === 'committed') {
							const row = created.records.find(
								(r: { model: string; id: string }) => r.model === 'activities'
							);
							if (row !== undefined) {
								const meeting = yield* Schema.decodeUnknownEffect(id_of('activities'))(row.id);
								const uploaded = yield* Effect.all(
									allFiles.map((f) =>
										ctx.upload(f, 'meeting_recordings.audio').pipe(
											Effect.map((audio) => ({
												meeting,
												title: f.name,
												audio
											}))
										)
									),
									{ concurrency: 2 }
								);
								yield* ctx.act({ 'meeting_recordings.create': uploaded });
							}
						}
						return created;
					}).pipe(
						Effect.tap((result) => Effect.sync(() => resolve(result))),
						Effect.catch((err) => Effect.sync(() => reject(err)))
					)
				);
			});
			await clearRecordingDraft(storageKey);
			savedDraft = null;
			activeParts = [];
			queuedFiles = [];
			notify_outcome(ctx, outcome);
			if (outcome.kind === 'committed' || outcome.kind === 'pending_approval') {
				if (on_done) on_done(outcome);
				else {
					const created = outcome.records.find(
						(r: { model: string; id: string }) => r.model === 'activities'
					);
					if (created !== undefined) open_record('activities', created.id);
				}
			}
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			busy = null;
		}
	}

	const handleOutcome = (outcome: Outcome) => {
		if (outcome.kind !== 'committed' && outcome.kind !== 'pending_approval') return;
		if (on_done) on_done(outcome);
		else {
			const created = outcome.records.find(
				(r: { model: string; id: string }) => r.model === 'activities'
			);
			if (created !== undefined) open_record('activities', created.id);
		}
	};

	const options = [
		{
			type: 'recording' as const,
			icon: 'lucide:mic',
			title: t('activities.choice.recording'),
			hint: t('activities.choice.recording_hint')
		},
		{
			type: 'note' as const,
			icon: 'lucide:notebook-pen',
			title: t('activities.choice.note'),
			hint: t('activities.choice.note_hint')
		},
		{
			type: 'meeting' as const,
			icon: 'lucide:calendar-days',
			title: t('activities.choice.meeting'),
			hint: t('activities.choice.meeting_hint')
		}
	];
</script>

<div class="contents" {@attach lifetime}>
	{#if choice === null}
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{t('activities.choose_type')}</p>
			<Stack gap="sm">
				{#each options as option (option.type)}
					<button
						type="button"
						class="flex w-full items-start gap-3 rounded-lg border bg-card p-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
						onclick={() => (choice = option.type)}
					>
						<div class="mt-0.5 rounded-md border bg-muted/40 p-2 text-foreground">
							<Icon name={option.icon} class="size-4" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="text-sm font-medium">{option.title}</span>
								{#if option.type === 'recording' && savedDraft !== null}
									<span
										class="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
									>
										{t('activities.draft_saved', {
											duration: formatDuration(savedDraft.elapsedSeconds)
										})}
									</span>
								{/if}
							</div>
							<p class="mt-0.5 text-xs text-muted-foreground">{option.hint}</p>
						</div>
						<Icon name="lucide:chevron-right" class="mt-1 size-4 shrink-0 text-muted-foreground" />
					</button>
				{/each}
			</Stack>
		</Stack>
	{:else}
		<Stack gap="md">
			<Cluster align="center" justify="between">
				<Button
					variant="ghost"
					disabled={recorder !== null || busy !== null}
					onclick={() => (choice = null)}
				>
					<Icon name="lucide:arrow-left" class="mr-1.5 size-3.5" />
					{t('activities.change_type')}
				</Button>
			</Cluster>

			{#if choice === 'recording'}
				<Form
					{ctx}
					of="activities"
					mode="create"
					values={{ ...values, kind: 'recording' }}
					fields={['subject', 'occurred_at', 'contact_id', 'detail']}
					on_outcome={async (outcome) => {
						if (outcome.kind === 'committed') {
							void clearRecordingDraft(storageKey);
							savedDraft = null;
							const created = outcome.records.find(
								(r: { model: string; id: string }) => r.model === 'activities'
							);
							if (created !== undefined && queuedFiles.length > 0) {
								try {
									await uploadRecordingsForActivity(
										Schema.decodeUnknownSync(id_of('activities'))(created.id),
										queuedFiles
									);
									queuedFiles = [];
								} catch (error) {
									problem = error instanceof Error ? error.message : String(error);
								}
							}
						}
						handleOutcome(outcome);
					}}
				>
					{#snippet children(form)}
						<Section
							icon="lucide:mic"
							first
							name="capture"
							title={t('activities.choice.recording')}
						>
							<Stack gap="sm">
								<input
									bind:this={fileInput}
									type="file"
									accept="audio/*,video/*"
									multiple
									class="hidden"
									onchange={(event) => {
										const list = event.currentTarget.files;
										if (list && list.length > 0) {
											queuedFiles = [...queuedFiles, ...Array.from(list)];
											event.currentTarget.value = '';
										}
									}}
								/>
								{#if savedDraft !== null && recorder === null}
									<Alert.Root>
										<Alert.Description class="flex flex-wrap items-center justify-between gap-2">
											<span class="text-sm">
												{t('activities.draft_resume_hint', {
													duration: formatDuration(savedDraft.elapsedSeconds)
												})}
											</span>
											<Cluster gap="xs">
												<Button disabled={busy !== null} onclick={resumeCapture}>
													<Icon name="lucide:play" class="mr-1 size-3.5" />
													{t('meetings.resume')}
												</Button>
												<Button
													variant="outline"
													disabled={busy !== null}
													onclick={() => void saveRecordedDraft(form.values)}
												>
													{t('meetings.save_recording')}
												</Button>
												<Button
													variant="ghost"
													disabled={busy !== null}
													onclick={() => void discardCapture()}
												>
													{t('meetings.discard')}
												</Button>
											</Cluster>
										</Alert.Description>
									</Alert.Root>
								{:else if recorder === null}
									<Cluster gap="sm" align="center">
										<Button disabled={busy !== null} onclick={() => startCapture(null)}>
											<Icon name="lucide:mic" class="mr-1.5 size-3.5" />
											{t('meetings.record')}
										</Button>
										<Button
											variant="outline"
											disabled={busy !== null}
											onclick={() => fileInput?.click()}
										>
											<Icon name="lucide:upload" class="mr-1.5 size-3.5" />
											{t('meetings.upload_audio')}
										</Button>
									</Cluster>
								{:else}
									<Cluster gap="sm" align="center">
										{#if paused}
											<Button disabled={busy !== null} onclick={resumeCapture}>
												<Icon name="lucide:play" class="mr-1.5 size-3.5" />
												{t('meetings.resume')}
											</Button>
										{:else}
											<Button variant="outline" disabled={busy !== null} onclick={pauseCapture}>
												<Icon name="lucide:pause" class="mr-1.5 size-3.5" />
												{t('meetings.pause')}
											</Button>
										{/if}
										<Button
											variant="default"
											disabled={busy !== null}
											onclick={() => void saveRecordedDraft(form.values)}
										>
											{t('meetings.stop_and_save')}
										</Button>
										<Button
											variant="ghost"
											disabled={busy !== null}
											onclick={() => void discardCapture()}
										>
											{t('meetings.discard')}
										</Button>
										<span class="text-sm tabular-nums" role="status">
											{t(paused ? 'meetings.paused' : 'meetings.recording')}
											{formatDuration(seconds)}
										</span>
									</Cluster>
								{/if}
								{#if queuedFiles.length > 0}
									<div class="flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2.5">
										{#each queuedFiles as qf, i (`${qf.name}:${i}`)}
											<div class="flex items-center justify-between gap-2 text-xs">
												<span class="truncate font-medium">{qf.name}</span>
												<button
													type="button"
													class="text-muted-foreground hover:text-foreground"
													onclick={() => (queuedFiles = queuedFiles.filter((_, idx) => idx !== i))}
												>
													{t('meetings.discard')}
												</button>
											</div>
										{/each}
									</div>
								{/if}
								{#if busy === 'saving'}
									<p class="text-xs text-muted-foreground" role="status">
										{t('meetings.uploading')}
									</p>
								{/if}
								{#if problem !== null}
									<p role="alert" class="text-sm text-destructive">{problem}</p>
								{/if}
								<p class="text-xs text-muted-foreground">{t('meetings.auto_transcribe')}</p>
							</Stack>
						</Section>
						<Section icon="lucide:file-text" name="details" title={t('activities.details')}>
							<Grid minimum="compact">
								<Field {ctx} name="subject" />
								<Field {ctx} name="occurred_at" />
								<Field {ctx} name="contact_id" />
							</Grid>
							<Field {ctx} name="detail" />
						</Section>
					{/snippet}
				</Form>
			{:else if choice === 'note'}
				<Form
					{ctx}
					of="activities"
					mode="create"
					values={{ ...values, kind: 'note' }}
					fields={['subject', 'occurred_at', 'contact_id', 'detail']}
					on_outcome={handleOutcome}
				>
					<Section icon="lucide:notebook-pen" first name="note" title={t('activities.choice.note')}>
						<Grid minimum="compact">
							<Field {ctx} name="subject" />
							<Field {ctx} name="occurred_at" />
							<Field {ctx} name="contact_id" />
						</Grid>
						<Field {ctx} name="detail" />
					</Section>
				</Form>
			{:else}
				<Form
					{ctx}
					of="activities"
					mode="create"
					values={{ ...values, kind: 'meeting' }}
					fields={[
						'subject',
						'occurred_at',
						'contact_id',
						'scheduled_start_at',
						'scheduled_end_at',
						'scheduled_start_on',
						'scheduled_end_on',
						'location',
						'attendees',
						'detail',
						'calendar_notify'
					]}
					on_outcome={handleOutcome}
				>
					<Section
						icon="lucide:calendar-days"
						first
						name="meeting"
						title={t('activities.choice.meeting')}
					>
						<Grid minimum="compact">
							<Field {ctx} name="subject" />
							<Field {ctx} name="occurred_at" />
							<Field {ctx} name="contact_id" />
						</Grid>
					</Section>
					<Section icon="lucide:clock" name="schedule" title={t('meetings.schedule')}>
						<Grid minimum="compact">
							<Field {ctx} name="scheduled_start_at" />
							<Field {ctx} name="scheduled_end_at" />
							<Field {ctx} name="scheduled_start_on" />
							<Field {ctx} name="scheduled_end_on" />
							<Field {ctx} name="location" />
							<Field {ctx} name="attendees" />
							<Field {ctx} name="calendar_notify" />
						</Grid>
						<Field {ctx} name="detail" />
					</Section>
				</Form>
			{/if}
		</Stack>
	{/if}
</div>
