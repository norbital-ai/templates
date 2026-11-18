<script lang="ts">
	/**
	 * Speaker identification for one recording, entirely in this browser: the recording audio is decoded here
	 * and each separated voice embedded (`voice.ts`). Clear matches are assigned automatically; weaker matches
	 * are offered for a person to tag. Tagged voices are saved only with recorded consent.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { attach, fork } from '@norbital-ai/ui/effect';
	import { Effect, Option, Scope, Stream } from 'effect';
	import { watch } from 'runed';
	import type { FileRef, Id } from '@norbital-ai/bolt';
	import { Button, RunStatus, use_act } from '@norbital-ai/ui';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		decodeRecording,
		embedSpeakers,
		loadVoiceModel,
		recognise,
		suggest,
		type Segment
	} from './voice.js';

	let {
		ctx,
		meetingId,
		recordingId = null,
		audio,
		segments,
		company,
		labelMap = new Map()
	}: {
		ctx: PageContext;
		meetingId: Id<'activities'>;
		recordingId?: Id<'meeting_recordings'> | null;
		audio: FileRef | null | undefined;
		segments: readonly Segment[] | null | undefined;
		/** Whose contacts' profiles are compared; every profile when the meeting has no customer. */
		company: Id<'companies'> | null;
		labelMap?: ReadonlyMap<string, string>;
	} = $props();
	const t = ctx.t;

	const speakers = $derived(
		ctx.query({
			meeting_speakers: {
				where:
					recordingId !== null
						? { recording: { eq: recordingId } }
						: { meeting: { eq: meetingId }, recording: { is_null: true } },
				fields: ['label', 'voice_enrolled_at', 'revision'],
				order_by: { label: 'asc' },
				limit: 50,
				contact: { fields: ['full_name', 'voice_consent_at'] }
			}
		})
	);
	const profiles = $derived(
		ctx.query({
			contacts: {
				where: {
					voice_samples: { gt: 0 },
					voice_consent_at: { is_null: false },
					...(company === null ? {} : { company_id: { eq: company } })
				},
				fields: ['full_name', 'voice_embedding']
			}
		})
	);
	const rows = $derived(speakers.current?.meeting_speakers.rows ?? []);
	const known = $derived(
		(profiles.current?.contacts.rows ?? []).flatMap((p) =>
			p.voice_embedding == null
				? []
				: [
						{
							id: p.id,
							name: p.full_name,
							embedding: p.voice_embedding
						}
					]
		)
	);

	let embeddings = $state.raw<Record<string, number[]> | null>(null);
	let analysing = $state(false);
	let problem = $state<string | null>(null);
	let saving = $state<string | null>(null);
	let voiceRun = $state<string | null>(null);
	const attempted = new Set<string>();
	const act = use_act(ctx);
	let owner = $state.raw<Scope.Scope | undefined>(undefined);
	const lifetime = attach(() =>
		Effect.gen(function* () {
			owner = yield* Scope.Scope;
			yield* Effect.never;
		}).pipe(Effect.ensuring(Effect.sync(() => (owner = undefined))))
	);

	const analyse = () => {
		const scope = owner;
		if (scope === undefined || audio == null || analysing || embeddings !== null) return;
		analysing = true;
		problem = null;
		const segs: readonly Segment[] = segments ?? [];
		fork(
			Effect.scoped(
				Effect.gen(function* () {
					const [session, decoded] = yield* Effect.all(
						[loadVoiceModel(), decodeRecording(ctx.file_url(audio))],
						{ concurrency: 2 }
					);
					embeddings = yield* embedSpeakers(session, decoded, segs);
				})
			).pipe(
				Effect.catch((error) => Effect.sync(() => (problem = error.message))),
				Effect.ensuring(Effect.sync(() => (analysing = false))),
				Effect.forkIn(scope)
			)
		);
	};

	watch(
		() => owner !== undefined && rows.some((s) => s.contact != null || known.length > 0),
		(worth) => {
			if (worth) analyse();
		}
	);

	type Speaker = (typeof rows)[number];
	type Profile = {
		id: Id<'contacts'>;
	};
	const save = (speaker: Speaker, contact: Profile, automatic: boolean, consent = false) => {
		const scope = owner;
		const voice = embeddings?.[speaker.label];
		if (scope === undefined || voice === undefined || saving !== null) return;
		saving = speaker.id;
		voiceRun = null;
		attempted.add(`${speaker.id}:${speaker.contact?.id ?? ''}`);
		problem = null;
		fork(
			Effect.gen(function* () {
				const handle = ctx.run('meeting_speakers_save_voice', {
					meeting_speakers: [speaker.id],
					contact: contact.id,
					embedding: voice,
					automatic,
					consent
				});
				yield* handle;
				voiceRun = handle.id;
				const finished = yield* ctx
					.runs('meeting_speakers_save_voice', { where: { id: { eq: handle.id } }, limit: 1 })
					.pipe(
						Stream.map((page) => page.rows[0]),
						Stream.filter(
							(row) => row !== undefined && row.status !== 'queued' && row.status !== 'running'
						),
						Stream.runHead
					);
				const row = Option.getOrUndefined(finished);
				if (row?.status !== 'succeeded')
					problem = row?.error?.message ?? row?.status ?? 'Run unavailable';
			}).pipe(
				Effect.catch((error) => Effect.sync(() => (problem = error.message))),
				Effect.ensuring(Effect.sync(() => (saving = null))),
				Effect.forkIn(scope)
			)
		);
	};
	const taken = $derived(new Set(rows.flatMap((s) => (s.contact == null ? [] : [s.contact.id]))));
	watch(
		() => ({ owner, embeddings, rows, known, saving }),
		() => {
			if (owner === undefined || embeddings === null || saving !== null) return;
			for (const speaker of rows) {
				if (
					speaker.voice_enrolled_at != null ||
					attempted.has(`${speaker.id}:${speaker.contact?.id ?? ''}`)
				)
					continue;
				const voice = embeddings[speaker.label];
				if (voice === undefined) continue;
				if (speaker.contact?.voice_consent_at != null) {
					save(speaker, speaker.contact, false);
					return;
				}
				if (speaker.contact != null) continue;
				const match = recognise(voice, known);
				if (match !== null && !taken.has(match.id)) {
					save(speaker, match, true);
					return;
				}
			}
		}
	);
</script>

<div class="contents" {@attach lifetime}>
	<Stack gap="xs">
		<Inline align="center" justify="between">
			<span class="text-xs font-medium text-muted-foreground">{t('voice.title')}</span>
			{#if embeddings === null && audio != null}
				<Button variant="outline" disabled={analysing} onclick={analyse}
					>{t('voice.analyse')}</Button
				>
			{/if}
		</Inline>
		{#if analysing}<p class="text-meta" role="status">{t('voice.analysing')}</p>{/if}
		{#if voiceRun !== null}
			<RunStatus
				{ctx}
				automation="meeting_speakers_save_voice"
				run={voiceRun}
				title={t('voice.enrol')}
			/>
		{/if}
		{#if problem !== null}<p class="text-sm text-destructive">
				{t('voice.failed')}: {problem}
			</p>{/if}
		{#if embeddings !== null}
			{#each rows as speaker (speaker.id)}
				{@const voice = embeddings[speaker.label]}
				{@const pretty = labelMap.get(speaker.label) ?? speaker.label}
				{#if speaker.contact == null}
					{@const match =
						voice === undefined
							? null
							: suggest(
									voice,
									known.filter((p) => !taken.has(p.id))
								)}
					{#if match !== null}
						<Cluster gap="sm" align="center">
							<span class="text-sm">{pretty}</span>
							<Button
								disabled={saving !== null || act.pending}
								onclick={() =>
									act.run(
										ctx.act({
											'meeting_speakers.update': [
												{
													target: { id: speaker.id, revision: speaker.revision },
													set: { contact: match.id }
												}
											]
										})
									)}>{t('voice.suggest', { name: match.name })}</Button
							>
							<span class="text-meta">
								{t('voice.match', {
									score: new Intl.NumberFormat(ctx.locale, { style: 'percent' }).format(match.score)
								})}
							</span>
						</Cluster>
					{/if}
				{:else if speaker.voice_enrolled_at == null && speaker.contact.full_name}
					{@const contact = speaker.contact}
					{@const name = contact.full_name}
					<Cluster gap="sm" align="center">
						<span class="text-sm">{pretty}</span>
						{#if voice !== undefined}
							<Button
								variant="outline"
								disabled={saving !== null}
								onclick={() => save(speaker, contact, false, true)}
								>{t('voice.enrol', { name })}</Button
							>
						{/if}
					</Cluster>
				{/if}
			{/each}
		{/if}
	</Stack>
</div>
