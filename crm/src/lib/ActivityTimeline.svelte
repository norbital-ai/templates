<script lang="ts">
	import { Effect } from 'effect';
	import { SvelteSet } from 'svelte/reactivity';
	import { watch } from 'runed';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { fork } from '@norbital-ai/ui/effect';
	import type { Cursor, Id } from '@norbital-ai/bolt';
	import { Duration } from 'effect';
	import {
		Alert,
		Button,
		EmptyState,
		Sheet,
		enum_text,
		format,
		open_record
	} from '@norbital-ai/ui';
	import { Cluster, Inline, Scroll } from '@norbital-ai/ui/layout';
	import ConversationSlice from './ConversationSlice.svelte';
	import ActivityCreate from './ActivityCreate.svelte';
	import type { ActivityKindChoice } from './activity-create.js';
	import { activitySlices, type TimelineItem } from './activity-timeline.js';
	import {
		clearRecordingDraft,
		loadRecordingDraft,
		type PersistedRecording
	} from './recording-store.js';

	let {
		ctx,
		company,
		project
	}: { ctx: PageContext; company: Id<'companies'>; project?: Id<'projects'> } = $props();
	const scope = $derived(project ? { project_id: { eq: project } } : { company: { eq: company } });
	const context = $derived({ company, project, where: scope });
	const storageKey = $derived(project ? `project:${project}` : `company:${company}`);
	const t = ctx.t;
	/** `ctx.t` as the catalog lookup `enum_text` reads an activity kind's words through. */
	const words: { t(key: string): string } = ctx;
	const fields = [
		'subject',
		'kind',
		'occurred_at',
		'source_key',
		'source_user',
		'thread_key',
		'handle',
		'direction'
	] as const;
	const read = (owner: typeof context, after?: Cursor) =>
		ctx.query({
			activities: {
				where: owner.where,
				fields,
				order_by: { occurred_at: 'desc' },
				limit: 50,
				...(after === undefined ? {} : { after }),
				project_id: { fields: ['name'] }
			}
		});
	type Answer = NonNullable<ReturnType<typeof read>['current']>;
	const item = (row: Answer['activities']['rows'][number]) => ({
		...row,
		project_id: row.project_id?.id ?? null,
		project_name: row.project_id?.name ?? null
	});
	const latest = $derived(read(context));
	// the newest page is live; a row it pushed out stays shown until a full page proves it gone
	const retained = new Map<string, TimelineItem>();
	let held: typeof latest | undefined;
	const current = $derived.by(() => {
		if (held !== latest) retained.clear();
		held = latest;
		const page = latest.current?.activities;
		if (page === undefined) return undefined;
		const currentIds = new Set<string>(page.rows.map((row) => row.id));
		const oldest = page.rows.at(-1)?.occurred_at;
		for (const [id, row] of retained) {
			if (
				!currentIds.has(id) &&
				(page.next == null || (oldest != null && row.occurred_at > oldest))
			)
				retained.delete(id);
		}
		for (const row of page.rows) retained.set(row.id, item(row));
		return { next: page.next, rows: [...retained.values()] };
	});
	let archive = $state.raw<
		{ owner: typeof context; rows: TimelineItem[]; next: Cursor | null | undefined } | undefined
	>();
	let loadingOlder = $state(false);
	let olderFailed = $state(false);
	const older = $derived(archive?.owner === context ? archive.rows : []);
	let create = $state(false);
	let initialChoice = $state<ActivityKindChoice | undefined>(undefined);
	let pendingDraft = $state<PersistedRecording | null>(null);
	const expanded = new SvelteSet<string>();
	const slices = $derived(activitySlices([...(current?.rows ?? []), ...older]));
	const next = $derived(archive?.owner === context ? archive.next : current?.next);
	watch(
		() => context,
		() => expanded.clear()
	);
	$effect(() => {
		const key = storageKey;
		if (!create) {
			void loadRecordingDraft(key).then((found) => {
				if (storageKey === key) pendingDraft = found;
			});
		}
	});
	const more = () => {
		if (next == null || loadingOlder) return;
		const owner = context;
		loadingOlder = true;
		olderFailed = false;
		fork(
			read(owner, next).pipe(
				Effect.map(({ activities: page }) => {
					archive = {
						owner,
						rows: [...(archive?.owner === owner ? archive.rows : []), ...page.rows.map(item)],
						next: page.next
					};
				}),
				Effect.ensuring(Effect.sync(() => (loadingOlder = false)))
			),
			() => (olderFailed = true)
		);
	};
</script>

<Scroll name={t('crm.section.activities')} size="fill" inset>
	<Inline align="center" justify="between"
		><h3>{t('crm.section.activities')}</h3>
		<Button
			variant="outline"
			onclick={() => {
				initialChoice = undefined;
				create = true;
			}}>{t('timeline.new')}</Button
		></Inline
	>
	{#if pendingDraft !== null}
		<Alert.Root class="my-3">
			<Alert.Description class="flex flex-wrap items-center justify-between gap-2">
				<span class="text-sm">
					{t('activities.draft_resume_hint', {
						duration: new Intl.DurationFormat(ctx.locale, {
							style: 'digital',
							hoursDisplay: 'auto'
						}).format(Duration.parts(Duration.seconds(pendingDraft.elapsedSeconds)))
					})}
				</span>
				<Cluster gap="xs">
					<Button
						onclick={() => {
							initialChoice = 'recording';
							create = true;
						}}>{t('meetings.resume')}</Button
					>
					<Button
						variant="ghost"
						onclick={() => {
							void clearRecordingDraft(storageKey);
							pendingDraft = null;
						}}>{t('meetings.discard')}</Button
					>
				</Cluster>
			</Alert.Description>
		</Alert.Root>
	{/if}
	{#if latest.error !== undefined}
		<p role="alert">{t('timeline.read_failed')}</p>
	{:else if current === undefined}<p>{t('timeline.loading')}</p>
	{:else if slices.length === 0}<EmptyState
			title={t('timeline.empty')}
			hint={t('timeline.empty_help')}
		/>
	{:else}
		<ol class="timeline">
			{#each slices as slice (slice.id)}
				<li>
					<time datetime={slice.occurred_at}
						>{format({ kind: 'instant' }, slice.occurred_at, {
							locale: ctx.locale
						})}</time
					>
					{#if slice.kind === 'message'}
						<details
							ontoggle={(event) =>
								event.currentTarget.open ? expanded.add(slice.id) : expanded.delete(slice.id)}
						>
							<summary
								><strong>{slice.messages[0]?.subject}</strong>
								{#if slice.messages[0]?.project_name}<span class="project"
										>{slice.messages[0].project_name}</span
									>{/if}<span>{t('timeline.message_count', { count: slice.messages.length })}</span
								></summary
							>
							{#if expanded.has(slice.id)}<ConversationSlice {ctx} messages={slice.messages} />{/if}
						</details>
					{:else}
						<Button variant="ghost" onclick={() => open_record('activities', slice.id)}
							>{slice.messages[0]?.subject}</Button
						>
						<span class="kind"
							>{enum_text(slice.kind, {
								t: (key) => words.t(key),
								model: 'activities',
								field: 'kind'
							})}</span
						>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
	{#if olderFailed}<p role="alert">{t('timeline.load_failed')}</p>{/if}
	{#if next != null}<Button variant="outline" disabled={loadingOlder} onclick={more}
			>{t('timeline.older')}</Button
		>{/if}
</Scroll>

<Sheet
	open={create}
	on_open_change={(open) => {
		if (!open) {
			create = false;
			initialChoice = undefined;
		}
	}}
	title={t('timeline.new')}
>
	{#if create}
		<ActivityCreate
			{ctx}
			values={{ company, ...(project ? { project_id: project } : {}) }}
			initial={initialChoice}
			on_done={(outcome) => {
				if (outcome.kind !== 'committed' && outcome.kind !== 'pending_approval') return;
				create = false;
				initialChoice = undefined;
				pendingDraft = null;
				const activity = outcome.records.find(
					(record: { model: string; id: string }) => record.model === 'activities'
				);
				if (activity !== undefined) open_record('activities', activity.id);
			}}
		/>
	{/if}
</Sheet>

<style>
	h3 {
		font-size: 14px;
		font-weight: 600;
		margin: 0;
	}
	.timeline {
		list-style: none;
		margin: 0 0 16px;
		padding: 0 0 0 20px;
		border-left: 1px solid var(--color-border);
	}
	.timeline li {
		margin: 0 0 12px;
	}
	.timeline time,
	.kind,
	.project {
		display: block;
		color: var(--color-muted-foreground);
		font-size: 12px;
	}
	.timeline summary {
		cursor: pointer;
	}
	.timeline summary span {
		color: var(--color-muted-foreground);
		font-size: 12px;
		margin-left: 8px;
	}
</style>
