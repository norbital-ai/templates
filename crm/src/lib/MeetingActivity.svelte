<script lang="ts">
	/**
	 * One meeting or recording activity:
	 * - `Recordings` unifies Audio + Speakers + Transcript per recording entity (supports multiple audios per meeting,
	 *   browser pause/resume capture persisted in IndexedDB, and multi-file upload).
	 * - `Minutes` auto-generates from all recordings' transcriptions (and refreshes on demand after naming speakers).
	 * - `Action items` shows linked tasks.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { id_of, type FileRef, type Id } from '@norbital-ai/bolt';
	import { attach, fork, observe } from '@norbital-ai/ui/effect';
	import { Duration, Effect, Option, Schema, Scope } from 'effect';
	import { captureMeetingAudio } from './meeting-capture.js';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import {
		Badge,
		Button,
		Combobox,
		EmptyState,
		Icon,
		ReadonlyMarkdown,
		RecordShell,
		RunStatus,
		Show,
		Spinner,
		Table,
		use_act
	} from '@norbital-ai/ui';
	import { Cluster, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { transcriptMarkdown, type Segment } from './ai.js';
	import MeetingVoices from './MeetingVoices.svelte';
	import {
		buildRecordingFile,
		clearRecordingDraft,
		loadRecordingDraft,
		saveRecordingDraft,
		type PersistedRecording
	} from './recording-store.js';

	let { view, ctx }: { view: RecordView<'activities'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const isMeeting = $derived(record?.kind === 'meeting');
	const SCHEDULE = [
		'scheduled_start_at',
		'scheduled_end_at',
		'scheduled_start_on',
		'scheduled_end_on',
		'location',
		'attendees',
		'detail',
		'status',
		'calendar_notify'
	] as const;
	const calendar = $derived(isMeeting ? record?.$sync?.['google_calendar'] : undefined);

	const sections = $derived<RecordSection[]>([
		{
			name: 'meeting',
			icon: isMeeting ? 'lucide:video' : 'lucide:mic',
			title: t(isMeeting ? 'models.meetings.singular' : 'activities.choice.recording'),
			fields: isMeeting
				? ['subject', 'occurred_at', 'company', 'project_id']
				: ['subject', 'occurred_at', 'company', 'project_id', 'contact_id', 'detail']
		},
		...(isMeeting
			? [
					{
						name: 'schedule',
						icon: 'lucide:calendar-days',
						title: t('meetings.schedule'),
						fields: [...SCHEDULE]
					}
				]
			: [])
	]);

	const recordingsQuery = $derived(
		record === null
			? null
			: ctx.query({
					meeting_recordings: {
						where: { meeting: { eq: record.id } },
						fields: [
							'title',
							'audio',
							'transcription',
							'transcription_error',
							'segments',
							'revision'
						],
						order_by: { created_at: 'asc' },
						speakers: {
							fields: ['label', 'name', 'contact', 'voice_enrolled_at', 'revision'],
							order_by: { label: 'asc' },
							contact: { fields: ['full_name'] }
						}
					}
				})
	);

	// Legacy single-recording speakers (only for activities created before `meeting_recordings`).
	const legacySpeakersQuery = $derived(
		record?.recording == null
			? null
			: ctx.query({
					meeting_speakers: {
						where: { meeting: { eq: record.id }, recording: { is_null: true } },
						fields: ['label', 'name', 'contact', 'voice_enrolled_at', 'revision'],
						order_by: { label: 'asc' },
						limit: 50,
						contact: { fields: ['full_name'] }
					}
				})
	);

	const contactsQuery = $derived(
		record === null
			? null
			: ctx.query({
					contacts: {
						...(record.company ? { where: { company_id: { eq: record.company } } } : {}),
						fields: ['full_name'],
						order_by: { full_name: 'asc' },
						limit: 100
					}
				})
	);

	type SpeakerRow = {
		readonly id: Id<'meeting_speakers'>;
		readonly label: string;
		readonly name: string | null;
		readonly contact: { readonly id: Id<'contacts'>; readonly full_name: string } | null;
		readonly revision: number;
	};

	type RecordingItem = (
		| { readonly kind: 'legacy'; readonly id: Id<'activities'> }
		| { readonly kind: 'child'; readonly id: Id<'meeting_recordings'> }
	) & {
		readonly title: string;
		readonly audio: FileRef;
		readonly transcription: 'none' | 'pending' | 'done' | 'failed' | 'unavailable';
		readonly transcription_error: string | null;
		readonly segments: readonly Segment[];
		readonly speakers: readonly SpeakerRow[];
		readonly revision: number;
	};

	const recordingItems = $derived.by((): readonly RecordingItem[] => {
		const list: RecordingItem[] = [];
		if (record?.recording != null) {
			list.push({
				kind: 'legacy',
				id: record.id,
				title: record.recording.name,
				audio: record.recording,
				transcription: record.transcription,
				transcription_error: record.transcription_error ?? null,
				segments: record.segments ?? [],
				speakers: legacySpeakersQuery?.current?.meeting_speakers.rows ?? [],
				revision: record.revision
			});
		}
		for (const rec of recordingsQuery?.current?.meeting_recordings.rows ?? []) {
			list.push({
				kind: 'child',
				id: rec.id,
				title: rec.title ?? rec.audio.name,
				audio: rec.audio,
				transcription: rec.transcription,
				transcription_error: rec.transcription_error ?? null,
				segments: rec.segments ?? [],
				speakers: rec.speakers,
				revision: rec.revision
			});
		}
		return list;
	});

	const hasTranscribed = $derived(recordingItems.some((r) => r.transcription === 'done'));
	const anyTranscribing = $derived(recordingItems.some((r) => r.transcription === 'pending'));

	const notesRuns = observe(() =>
		record === null
			? null
			: ctx.runs('meeting_notes', {
					where: { input: { eq: { meeting: record.id } } },
					limit: 1
				})
	);
	const latestNotesRun = $derived(notesRuns.current?.rows[0] ?? null);
	const notesBusy = $derived(
		latestNotesRun?.status === 'queued' || latestNotesRun?.status === 'running'
	);

	const headerStatus = $derived(
		recordingItems.length === 0
			? t('meetings.no_recording_short')
			: anyTranscribing
				? t('meetings.step.transcribing')
				: notesBusy
					? t('meetings.notes_generating')
					: hasTranscribed
						? record?.notes
							? t('meetings.step.done')
							: t('meetings.minutes_ready')
						: t('meetings.step.failed')
	);

	/** Maps raw diarizer UUID/hash labels to readable `Speaker 1`, `Speaker 2`, etc. */
	function speakerLabels(speakers: readonly SpeakerRow[]): ReadonlyMap<string, string> {
		const map = new Map<string, string>();
		let n = 1;
		for (const s of speakers) {
			const opaque =
				/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s.label) || /^[0-9a-f]{16,}$/i.test(s.label);
			map.set(s.label, opaque ? t('meetings.speaker_n', { n }) : s.label);
			n += 1;
		}
		return map;
	}

	function resolvedSpeakerNames(
		speakers: readonly SpeakerRow[],
		labelMap: ReadonlyMap<string, string>
	): Record<string, string> {
		return Object.fromEntries(
			speakers.map((s): [string, string] => [
				s.label,
				s.contact?.full_name ?? s.name ?? labelMap.get(s.label) ?? s.label
			])
		);
	}

	let run = $state<string | null>(null);
	let recorder = $state<MediaRecorder | null>(null);
	let paused = $state(false);
	let seconds = $state(0);
	let problem = $state<string | null>(null);
	let saving = $state(false);
	let pending = $state(false);
	let savedDraft = $state<PersistedRecording | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let activeParts: Blob[] = [];
	let activeMime = '';
	let startedAtIso = '';
	let owner = $state.raw<Scope.Scope | undefined>(undefined);
	const storageKey = $derived(record === null ? null : `activity:${record.id}`);

	$effect(() => {
		const key = storageKey;
		if (key === null) return;
		void loadRecordingDraft(key).then((found) => {
			if (storageKey === key) savedDraft = found;
		});
	});

	const autoTriggered = new Set<string>();
	$effect(() => {
		if (
			record !== null &&
			hasTranscribed &&
			!record.notes &&
			notesRuns.current !== undefined &&
			latestNotesRun === null &&
			!autoTriggered.has(record.id)
		) {
			autoTriggered.add(record.id);
			refreshMinutes();
		}
	});

	const lifetime = attach(() =>
		Effect.gen(function* () {
			owner = yield* Scope.Scope;
			yield* Effect.never;
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					owner = undefined;
				})
			)
		)
	);

	const act = use_act(ctx);

	function retryRecording(item: RecordingItem): void {
		if (item.kind === 'legacy') {
			if (record === null) return;
			act.run(
				ctx.act({
					'activities.update': [
						{
							target: { id: record.id, revision: record.revision },
							set: { transcription: 'pending', transcription_error: null }
						}
					]
				})
			);
			return;
		}
		act.run(
			ctx.act({
				'meeting_recordings.update': [
					{
						target: { id: item.id, revision: item.revision },
						set: { transcription: 'pending', transcription_error: null }
					}
				]
			})
		);
	}

	function deleteRecording(item: RecordingItem): void {
		if (item.kind !== 'child') return;
		act.run(
			ctx.act({
				'meeting_recordings.delete': [{ target: { id: item.id, revision: item.revision } }]
			})
		);
	}

	function assignSpeakerContact(speaker: SpeakerRow, contactId: string): void {
		act.run(
			ctx.act({
				'meeting_speakers.update': [
					{
						target: { id: speaker.id, revision: speaker.revision },
						set: {
							contact: Option.getOrNull(Schema.decodeUnknownOption(id_of('contacts'))(contactId))
						}
					}
				]
			})
		);
	}

	function refreshMinutes(): void {
		if (record === null) return;
		const handle = ctx.run('meeting_notes', { meeting: record.id });
		run = handle.id;
		act.run(handle);
	}

	async function persistMeetingDraft(extraSegments: readonly (readonly Blob[])[] = []) {
		if (storageKey === null) return;
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

	function record_(existing: PersistedRecording | null = null): void {
		const meeting = record;
		const scope = owner;
		const key = storageKey;
		if (
			meeting === null ||
			scope === undefined ||
			key === null ||
			pending ||
			saving ||
			recorder !== null
		)
			return;
		problem = null;
		pending = true;
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
				pending = false;
			},
			tick: () => {
				seconds += 1;
			},
			chunk: (part) => {
				activeParts.push(part);
				void persistMeetingDraft(priorSegments);
			}
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					recorder = null;
					paused = false;
					pending = false;
				})
			)
		);
		const operation = Effect.fn('Meeting.recordCapture')(function* () {
			const audio = yield* capture;
			activeMime = audio.mimeType || activeMime;
			if (audio.parts.length > 0) activeParts = [...audio.parts];
			yield* Effect.promise(() => persistMeetingDraft(priorSegments));
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
						pending = false;
					})
				),
				Effect.forkIn(scope)
			)
		);
	}

	function pause_(): void {
		if (recorder?.state === 'recording') {
			recorder.pause();
			paused = true;
			void persistMeetingDraft(savedDraft?.segments.slice(0, -1) ?? []);
		}
	}

	function resume_(): void {
		if (recorder !== null && recorder.state === 'paused') {
			recorder.resume();
			paused = false;
			return;
		}
		if (recorder === null && savedDraft !== null) {
			record_(savedDraft);
		}
	}

	async function discard_(): Promise<void> {
		if (recorder !== null && recorder.state !== 'inactive') recorder.stop();
		activeParts = [];
		seconds = 0;
		paused = false;
		savedDraft = null;
		if (storageKey !== null) await clearRecordingDraft(storageKey);
	}

	async function uploadFiles(files: readonly File[]): Promise<void> {
		const meeting = record;
		if (meeting === null || files.length === 0 || saving) return;
		problem = null;
		saving = true;
		try {
			await new Promise<void>((resolve, reject) => {
				fork(
					Effect.gen(function* () {
						const rows = yield* Effect.all(
							files.map((file) =>
								ctx
									.upload(file, 'meeting_recordings.audio')
									.pipe(Effect.map((audio) => ({ meeting: meeting.id, title: file.name, audio })))
							),
							{ concurrency: 2 }
						);
						yield* ctx.act({ 'meeting_recordings.create': rows });
					}).pipe(
						Effect.tap(() => Effect.sync(() => resolve())),
						Effect.catch((err) => Effect.sync(() => reject(err)))
					)
				);
			});
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	async function save_(): Promise<void> {
		const meeting = record;
		const key = storageKey;
		if (meeting === null || key === null || saving) return;
		problem = null;
		saving = true;
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
							key,
							startedAt: startedAtIso || new Date().toISOString(),
							elapsedSeconds: seconds,
							mimeType: activeMime || 'audio/webm',
							segments: [activeParts],
							updatedAt: new Date().toISOString()
						}
					: null);
			if (draft === null) return;
			const file = await buildRecordingFile(draft, meeting.subject || 'recording');
			await new Promise<void>((resolve, reject) => {
				fork(
					Effect.gen(function* () {
						const audio = yield* ctx.upload(file, 'meeting_recordings.audio');
						yield* ctx.act({
							'meeting_recordings.create': [
								{
									meeting: meeting.id,
									title: file.name,
									audio
								}
							]
						});
					}).pipe(
						Effect.tap(() => Effect.sync(() => resolve())),
						Effect.catch((err) => Effect.sync(() => reject(err)))
					)
				);
			});
			await clearRecordingDraft(key);
			savedDraft = null;
			activeParts = [];
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	const fields = isMeeting
		? ([
				'subject',
				'occurred_at',
				'company',
				'project_id',
				'scheduled_start_at',
				'scheduled_end_at',
				'scheduled_start_on',
				'scheduled_end_on',
				'location',
				'attendees',
				'detail',
				'status',
				'calendar_notify'
			] as const)
		: (['subject', 'occurred_at', 'company', 'project_id', 'contact_id', 'detail'] as const);
</script>

{#snippet header()}
	{#if calendar?.status === 'failed'}<p role="alert" class="text-sm text-destructive">
			{calendar.message}
		</p>{:else if calendar?.status === 'pending'}<p class="text-meta" role="status">
			{t('meetings.calendar_saving')}
		</p>{/if}
	<span class="text-meta" role="status">{headerStatus}</span>
	{#if hasTranscribed && !notesBusy}
		<Button variant="outline" disabled={act.pending} onclick={refreshMinutes}>
			{t('meetings.refresh_minutes')}
		</Button>
	{/if}
{/snippet}

{#snippet recordingsTab()}
	<Scroll name={t('meetings.recordings')} size="fill" inset>
		<Stack gap="md">
			<input
				bind:this={fileInput}
				type="file"
				accept="audio/*,video/*"
				multiple
				class="hidden"
				onchange={(event) => {
					const list = event.currentTarget.files;
					if (list && list.length > 0) {
						void uploadFiles(Array.from(list));
						event.currentTarget.value = '';
					}
				}}
			/>
			<Cluster gap="sm" align="center">
				{#if recorder === null && savedDraft === null}
					<Button disabled={pending || saving} onclick={() => record_(null)}>
						<Icon name="lucide:mic" class="mr-1.5 size-3.5" />
						{t('meetings.record_start')}
					</Button>
					<Button variant="outline" disabled={pending || saving} onclick={() => fileInput?.click()}>
						<Icon name="lucide:upload" class="mr-1.5 size-3.5" />
						{t('meetings.upload_audio')}
					</Button>
				{:else if recorder === null && savedDraft !== null}
					<Button disabled={pending || saving} onclick={resume_}>{t('meetings.resume')}</Button>
					<Button variant="outline" disabled={saving} onclick={() => void save_()}>
						{t('meetings.save_recording')}
					</Button>
					<Button variant="ghost" disabled={saving} onclick={() => void discard_()}>
						{t('meetings.discard')}
					</Button>
					<span class="text-sm tabular-nums" role="status">
						{t('meetings.paused')}
						{new Intl.DurationFormat(ctx.locale, { style: 'digital', hoursDisplay: 'auto' }).format(
							Duration.parts(Duration.seconds(savedDraft.elapsedSeconds))
						)}
					</span>
				{:else}
					{#if paused}
						<Button disabled={saving} onclick={resume_}>{t('meetings.resume')}</Button>
					{:else}
						<Button variant="outline" disabled={saving} onclick={pause_}>
							{t('meetings.pause')}
						</Button>
					{/if}
					<Button disabled={saving} onclick={() => void save_()}>
						{t('meetings.stop_and_save')}
					</Button>
					<Button variant="ghost" disabled={saving} onclick={() => void discard_()}>
						{t('meetings.discard')}
					</Button>
					<span class="text-sm tabular-nums" role="status">
						{t(paused ? 'meetings.paused' : 'meetings.recording')}
						{new Intl.DurationFormat(ctx.locale, { style: 'digital', hoursDisplay: 'auto' }).format(
							Duration.parts(Duration.seconds(seconds))
						)}
					</span>
				{/if}
				{#if saving}<span class="text-meta" role="status">{t('meetings.uploading')}</span>{/if}
			</Cluster>
			{#if problem !== null}<p class="text-sm text-destructive">{problem}</p>{/if}

			{#if recordingItems.length === 0}
				<EmptyState variant="inset" title={t('meetings.no_recording')} />
			{:else}
				<Stack gap="md">
					{#each recordingItems as item (item.id)}
						{@const labelMap = speakerLabels(item.speakers)}
						{@const namesMap = resolvedSpeakerNames(item.speakers, labelMap)}
						{@const contacts = contactsQuery?.current?.contacts.rows ?? []}
						<div class="rounded-lg border bg-card p-4">
							<Stack gap="md">
								<Cluster align="center" justify="between" gap="sm">
									<Cluster align="center" gap="sm">
										<Icon name="lucide:audio-lines" class="size-4 text-muted-foreground" />
										<span class="text-label">{item.title}</span>
										<Badge
											variant={item.transcription === 'done'
												? 'success'
												: item.transcription === 'failed' || item.transcription === 'unavailable'
													? 'destructive'
													: 'outline'}
										>
											{t(`models.meetings.fields.transcription.${item.transcription}`)}
										</Badge>
									</Cluster>
									<Cluster align="center" gap="xs">
										{#if item.transcription === 'failed'}
											<Button
												variant="outline"
												disabled={act.pending}
												onclick={() => retryRecording(item)}
											>
												{t('meetings.retry')}
											</Button>
										{/if}
										{#if item.kind === 'child'}
											<Button
												variant="ghost"
												disabled={act.pending}
												onclick={() => deleteRecording(item)}
											>
												<Icon name="lucide:trash-2" class="size-3.5" />
											</Button>
										{/if}
									</Cluster>
								</Cluster>

								<Show
									{ctx}
									kind={{ kind: 'file', accept: ['audio/*', 'video/*'], max: '20MiB' }}
									value={item.audio}
								/>

								{#if item.transcription === 'pending'}
									<EmptyState variant="inset" title={t('meetings.transcribing')} />
								{:else if item.transcription === 'unavailable'}
									<EmptyState
										variant="inset"
										title={t('meetings.unavailable')}
										hint={item.transcription_error ?? t('meetings.unavailable_hint')}
									/>
								{:else if item.transcription === 'failed'}
									<EmptyState
										variant="inset"
										tone="danger"
										title={t('meetings.failed')}
										hint={item.transcription_error ?? ''}
									/>
								{:else if item.transcription === 'done'}
									{#if item.speakers.length > 0}
										<div class="rounded-md border bg-muted/20 p-3">
											<Stack gap="sm">
												{#if record}
													<MeetingVoices
														{ctx}
														meetingId={record.id}
														recordingId={item.kind === 'child' ? item.id : null}
														audio={item.audio}
														segments={item.segments}
														company={record.company ?? null}
														{labelMap}
													/>
												{/if}
												<div class="flex flex-wrap gap-2">
													{#each item.speakers as sp (sp.id)}
														<div
															class="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1 text-xs"
														>
															<span class="font-medium text-muted-foreground">
																{labelMap.get(sp.label) ?? sp.label}
															</span>
															<Combobox
																variant="ghost"
																clearable
																aria-label={labelMap.get(sp.label) ?? sp.label}
																placeholder={sp.name ?? t('meetings.pick_speaker')}
																value={sp.contact?.id ?? null}
																disabled={act.pending}
																options={contacts.map((c) => ({
																	value: c.id,
																	label: c.full_name
																}))}
																on_change={(value) => assignSpeakerContact(sp, value ?? '')}
															/>
														</div>
													{/each}
												</div>
											</Stack>
										</div>
									{/if}

									{#if item.segments.length === 0}
										<EmptyState variant="inset" title={t('meetings.no_speech')} />
									{:else}
										<div class="border-t pt-3">
											<ReadonlyMarkdown value={transcriptMarkdown(item.segments, namesMap)} />
										</div>
									{/if}
								{/if}
							</Stack>
						</div>
					{/each}
				</Stack>
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet notes()}
	<Scroll name={t('meetings.notes')} size="fill" inset>
		<Stack gap="md">
			{#if run !== null}
				<RunStatus {ctx} automation="meeting_notes" {run} />
			{:else if latestNotesRun !== null && notesBusy}
				<RunStatus {ctx} automation="meeting_notes" run={latestNotesRun.id} />
			{/if}
			{#if record?.notes}
				<ReadonlyMarkdown value={record.notes} />
			{:else if anyTranscribing || notesBusy}
				<Cluster gap="sm" align="center" justify="center" class="py-10">
					<Spinner class="size-4" />
					<span class="text-sm text-muted-foreground">
						{t(anyTranscribing ? 'meetings.transcribing' : 'meetings.notes_generating')}
					</span>
				</Cluster>
			{:else if latestNotesRun?.status === 'failed'}
				<EmptyState
					variant="inset"
					tone="danger"
					title={t('meetings.failed')}
					hint={latestNotesRun.error?.message ?? ''}
				/>
			{:else}
				<EmptyState variant="inset" title={t('meetings.notes_empty')} />
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet actions()}
	{#if record}
		<Table
			{ctx}
			of="tasks"
			key="meeting-actions"
			where={{ meeting: { eq: record.id } }}
			toolbar={{ title: t('meetings.action_items'), new: false }}
			order_by={{ due_on: 'asc' }}
			columns={['subject', 'due_on', 'owner', 'status']}
		/>
	{/if}
{/snippet}

<div class="contents" {@attach lifetime}>
	{#if record === null}
		<RecordShell
			{ctx}
			of="activities"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
			{sections}
		/>
	{:else}
		<RecordShell
			{ctx}
			of="activities"
			id={record.id}
			subtitle={['occurred_at']}
			{fields}
			{sections}
			actions={header}
			tabs={[
				{
					name: 'recordings',
					title: t('meetings.recordings'),
					icon: 'lucide:mic',
					body: recordingsTab
				},
				{ name: 'notes', title: t('meetings.notes'), icon: 'lucide:notebook-pen', body: notes },
				{
					name: 'actions',
					title: t('meetings.action_items'),
					icon: 'lucide:list-checks',
					body: actions
				}
			]}
		/>
	{/if}
</div>
