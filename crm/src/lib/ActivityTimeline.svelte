<script lang="ts">
	import { Effect } from 'effect';
	import { SvelteSet } from 'svelte/reactivity';
	import { watch } from '@norbital-ai/ui/behaviors';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { fork } from '@norbital-ai/ui/effect';
	import type { Cursor, Id } from '@norbital-ai/bolt';
	import { Duration } from 'effect';
	import {
		Alert,
		Button,
		EmptyState,
		Sheet,
		Timeline,
		enum_text,
		format,
		open_record,
		type TimelineEntry
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
		project,
		contact,
		allowNew = true
	}: {
		ctx: PageContext;
		company?: Id<'companies'>;
		project?: Id<'projects'>;
		contact?: Id<'contacts'>;
		allowNew?: boolean;
	} = $props();
	const scope = $derived(
		project
			? { project_id: { eq: project } }
			: contact
				? { contact_id: { eq: contact } }
				: company
					? { company: { eq: company } }
					: {}
	);
	const context = $derived({ company, project, contact, where: scope });
	const storageKey = $derived(
		project ? `project:${project}` : contact ? `contact:${contact}` : `company:${company ?? 'all'}`
	);
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
	type Slice = (typeof slices)[number];
	type ActivityTimelineEntry = TimelineEntry & { readonly slice: Slice };
	const kindIcon = (kind: string): string => {
		switch (kind) {
			case 'message':
				return 'lucide:message-square';
			case 'meeting':
				return 'lucide:calendar-days';
			case 'call':
				return 'lucide:phone';
			case 'recording':
				return 'lucide:mic';
			case 'milestone':
				return 'lucide:flag';
			default:
				return 'lucide:sticky-note';
		}
	};
	const timelineEntries = $derived<ActivityTimelineEntry[]>(
		slices.map((slice) => {
			const when = format({ kind: 'instant' }, slice.occurred_at, { locale: ctx.locale });
			const first = slice.messages[0];
			const title = first?.subject ?? '';
			const projectName = first?.project_name ?? null;
			if (slice.kind === 'message') {
				const isOpen = expanded.has(slice.id);
				return {
					key: slice.id,
					icon: kindIcon(slice.kind),
					title,
					line: [
						when,
						...(projectName ? [projectName] : []),
						t('timeline.message_count', { count: slice.messages.length })
					],
					expanded: isOpen,
					ontoggle: () => (isOpen ? expanded.delete(slice.id) : expanded.add(slice.id)),
					slice
				};
			}
			return {
				key: slice.id,
				icon: kindIcon(slice.kind),
				title,
				line: [
					when,
					enum_text(slice.kind, {
						t: (key) => words.t(key),
						model: 'activities',
						field: 'kind'
					}),
					...(projectName ? [projectName] : [])
				],
				expanded: false,
				onpick: () => open_record('activities', slice.id),
				slice
			};
		})
	);
	watch(
		() => context,
		() => expanded.clear()
	);
	$effect(() => {
		if (!allowNew) {
			pendingDraft = null;
			return;
		}
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
	<div class="mb-3">
		<Inline align="center" justify="between">
			<h3 class="text-sm font-medium">{t('crm.section.activities')}</h3>
			{#if allowNew}
				<Button
					variant="outline"
					onclick={() => {
						initialChoice = undefined;
						create = true;
					}}>{t('timeline.new')}</Button
				>
			{/if}
		</Inline>
	</div>
	{#if allowNew && pendingDraft !== null}
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
	{:else if current === undefined}<p class="text-sm text-muted-foreground">
			{t('timeline.loading')}
		</p>
	{:else}
		<Timeline entries={timelineEntries} label={t('crm.section.activities')}>
			{#snippet item({ slice })}
				{#if slice.kind === 'message'}
					<ConversationSlice {ctx} messages={slice.messages} />
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title={t('timeline.empty')} hint={t('timeline.empty_help')} />
			{/snippet}
		</Timeline>
	{/if}
	{#if olderFailed}<p role="alert" class="mt-3">{t('timeline.load_failed')}</p>{/if}
	{#if next != null}
		<div class="mt-3">
			<Button variant="outline" disabled={loadingOlder} onclick={more}>{t('timeline.older')}</Button
			>
		</div>
	{/if}
</Scroll>

{#if allowNew}
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
				values={{
					...(company ? { company } : {}),
					...(project ? { project_id: project } : {}),
					...(contact ? { contact_id: contact } : {})
				}}
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
{/if}
