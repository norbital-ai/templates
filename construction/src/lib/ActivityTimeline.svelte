<!-- @component Polymorphic chronological activity timeline backed by `@norbital-ai/ui` `<Timeline>`, scoped to a project (with roll-up), task, contract, or business partner. -->
<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Button,
		EmptyState,
		Icon,
		Image,
		RecordShell,
		Sheet,
		Spinner,
		Timeline,
		enum_text,
		format,
		open_record,
		type TimelineEntry
	} from '@norbital-ai/ui';
	import { Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';

	type AboutTarget =
		| { readonly model: 'projects'; readonly id: Id<'projects'> }
		| { readonly model: 'tasks'; readonly id: Id<'tasks'> }
		| { readonly model: 'contracts'; readonly id: Id<'contracts'> }
		| { readonly model: 'contacts'; readonly id: Id<'contacts'> };

	let {
		ctx,
		about
	}: {
		ctx: PageContext;
		about: AboutTarget;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};
	const canCreate = $derived(ctx.catalog?.activities?.create !== undefined);
	let createOpen = $state(false);

	const whereClause = $derived.by(() => {
		if (about.model === 'projects') return { about: { projects: { eq: about.id } } };
		if (about.model === 'tasks') return { about: { tasks: { eq: about.id } } };
		if (about.model === 'contracts') return { about: { contracts: { eq: about.id } } };
		return { about: { contacts: { eq: about.id } } };
	});

	const activityQuery = $derived(
		ctx.query({
			activities: {
				where: whereClause,
				fields: ['about', 'title', 'description', 'occurred_at', 'attachments'],
				order_by: { occurred_at: 'desc' },
				limit: 200,
				author: { fields: ['name'] },
				source_message_id: { fields: ['transport', 'sender_name'] }
			}
		})
	);

	type ActivityRow = NonNullable<typeof activityQuery.current>['activities']['rows'][number];
	type ActivityTimelineEntry = TimelineEntry & { readonly row: ActivityRow };

	const rows = $derived<readonly ActivityRow[]>(activityQuery.current?.activities.rows ?? []);

	const entries = $derived<ActivityTimelineEntry[]>(
		rows.map((row) => {
			const msg = row.source_message_id;
			const who =
				row.author?.name ??
				(msg
					? `${msg.sender_name ?? t('tasks.comment_author_unknown')} · ${enum_text(msg.transport, {
							t: rawT,
							model: 'project_messages',
							field: 'transport'
						})}`
					: null);
			const when = format({ kind: 'instant' }, row.occurred_at, { locale: ctx.locale });
			return {
				key: row.id,
				icon: msg ? 'lucide:message-circle-more' : 'lucide:activity',
				title: row.title,
				line: [when, ...(who ? [who] : [])],
				onpick: () => open_record('activities', row.id),
				row
			};
		})
	);
</script>

<Scroll name={t('tasks.activity_title')} size="fill" inset>
	<Stack gap="md">
		<Inline align="center" justify="between">
			<span class="text-overline">{t('tasks.activity_title')}</span>
			{#if canCreate}
				<Button variant="outline" onclick={() => (createOpen = true)}>
					<Icon name="lucide:plus" class="size-3.5" />
					{t('activities.log')}
				</Button>
			{/if}
		</Inline>

		{#if activityQuery.loading && !activityQuery.current}
			<Inline gap="sm" align="center" aria-busy="true">
				<Spinner />
				<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
			</Inline>
		{:else if activityQuery.error}
			<Alert.Root variant="destructive">
				<Alert.Title>{activityQuery.error.message}</Alert.Title>
			</Alert.Root>
		{:else}
			<Timeline {entries} label={t('tasks.activity_title')}>
				{#snippet item({ row })}
					{#if row.description?.trim() || (row.attachments?.length ?? 0) > 0}
						<Stack gap="xs">
							{#if row.description?.trim()}
								<p class="whitespace-pre-wrap text-sm text-foreground">{row.description}</p>
							{/if}
							{#if row.attachments && row.attachments.length > 0}
								<Cluster gap="xs">
									{#each row.attachments as file (file.id)}
										<a href={ctx.file_url(file)} target="_blank" rel="noopener" title={file.name}>
											{#if file.mime.startsWith('image/')}
												<Image
													src={ctx.file_url(file, { preview: 512 })}
													alt={file.name}
													class="size-16 rounded-inset border border-border"
													image_class="object-cover"
												/>
											{:else}
												<Inline gap="xs" align="center">
													<Icon name="lucide:paperclip" class="size-3.5 text-muted-foreground" />
													<span class="text-xs text-muted-foreground underline">{file.name}</span>
												</Inline>
											{/if}
										</a>
									{/each}
								</Cluster>
							{/if}
						</Stack>
					{/if}
				{/snippet}
				{#snippet empty()}
					<EmptyState
						variant="inset"
						icon="file"
						title={t('tasks.activity_title')}
						hint={t('tasks.no_activity')}
					/>
				{/snippet}
			</Timeline>
		{/if}
	</Stack>
</Scroll>

{#if canCreate}
	<Sheet
		open={createOpen}
		on_open_change={(open) => {
			if (!open) createOpen = false;
		}}
		title={t('activities.log')}
	>
		{#if createOpen}
			<RecordShell
				{ctx}
				of="activities"
				mode="create"
				values={{ about }}
				on_done={() => (createOpen = false)}
			/>
		{/if}
	</Sheet>
{/if}
