<script lang="ts">
	import { run, bolt } from '$bolt';
	import { Effect, Schema } from 'effect';
	import { watch } from 'runed';
	import type { ListRow } from '@norbital-ai/bolt';
	import { AppShell, Cluster, Split, Stack } from '@norbital-ai/ui/layout';
	import { Board, Button, TimeInput, EmptyState, Map, useKinds } from '@norbital-ai/ui';
	import Icon from '@iconify/svelte';
	import { csvRecords } from '../../lib/csv.js';
	import { live } from '../../lib/live.svelte.js';
	import { dayIn, dayOf, getErrorMessage } from '../../lib/format.js';
	import { xlsxRecords } from '../../lib/xlsx.js';
	import { decodeWorkOrders } from '../../lib/work-order-sheet.js';
	class SheetFileUnavailable extends Schema.TaggedError<SheetFileUnavailable>()(
		'SheetFileUnavailable',
		{ message: Schema.String }
	) {}
	const t = bolt.t;
	const today = dayIn(useKinds().zone);
	/** The day is in the URL, so opening a record (which re-renders the page) keeps it. */
	let day = $state<string>(new URL(location.href).searchParams.get('day') ?? today);
	/** The day as a date; an unreadable one reads as today. */
	const date = $derived(dayOf(day) ?? today);
	watch(
		() => day,
		() => {
			const url = new URL(location.href);
			if (url.searchParams.get('day') === day) return;
			url.searchParams.set('day', day);
			history.replaceState(history.state, '', url);
		},
		{ lazy: false }
	);
	const jobs = live(() =>
		bolt.read('job_assignments', {
			where: { scheduled_for: { eq: date } },
			select: { site_id: true },
			limit: 1000
		})
	);
	const dayJobs = $derived(jobs.current?.rows ?? []);
	const siteIds = $derived([...new Set(dayJobs.map((job) => job.site_id))]);
	const sites = live(() =>
		siteIds.length === 0
			? null
			: bolt.read('sites', {
					where: { id: { in: siteIds } },
					select: { name: true, location: true },
					limit: 1000
				})
	);
	const siteName = $derived(
		new globalThis.Map((sites.current?.rows ?? []).map((site) => [site.id, site.name]))
	);
	const mappedSites = $derived(
		(sites.current?.rows ?? []).filter((site) => site.location != null).map((site) => site.id)
	);
	/** Read once for the board: which of the day's jobs carry a finding nobody has answered. */
	const open = live(() =>
		dayJobs.length === 0
			? null
			: bolt.read('suspicious_activity_logs', {
					where: {
						resolved_at: { isNull: true },
						job_assignment_id: { in: dayJobs.map((job) => job.id) }
					},
					select: { job_assignment_id: true },
					limit: 1000
				})
	);
	const suspicious = $derived(
		new Set((open.current?.rows ?? []).map((log) => log.job_assignment_id))
	);
	const statusLabel = (status: 'unassigned' | 'assigned' | 'completed') =>
		t(`component.status_${status}`);
	let message = $state<string | null>(null);
	let importing = $state(false);
	let picker = $state<HTMLInputElement>();
	const runImport = Effect.fn('Dispatch.importSheet')(function* (file: File) {
		const rows = /\.xlsx$/i.test(file.name)
			? yield* xlsxRecords(
					yield* Effect.tryPromise({
						try: () => file.arrayBuffer(),
						catch: (cause) => new SheetFileUnavailable({ message: getErrorMessage(cause) })
					})
				)
			: csvRecords(
					yield* Effect.tryPromise({
						try: () => file.text(),
						catch: (cause) => new SheetFileUnavailable({ message: getErrorMessage(cause) })
					})
				);
		if (rows.length === 0) {
			message = t('app.field_ops_controller.import_empty', { file: file.name });
			return;
		}
		const outcome = yield* bolt.act('job_assignments.import_work_orders', {
			rows: yield* decodeWorkOrders(rows)
		});
		message =
			outcome.kind === 'committed'
				? t('app.field_ops_controller.import_done', {
						count: outcome.output.created,
						file: file.name
					})
				: t('app.field_ops_controller.import_failed');
	});
	function importSheet(file: File): Promise<void> {
		importing = true;
		message = null;
		return run(
			runImport(file).pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						message = getErrorMessage(error);
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						importing = false;
					})
				)
			)
		);
	}
</script>

{#snippet dayPicker()}
	<Cluster gap="xs" align="center">
		<label class="sr-only" for="dispatch-day"
			>{t('app.field_ops_controller.select_dispatch_date')}</label
		>
		<div class="w-40">
			<TimeInput
				id="dispatch-day"
				value={day}
				onChange={(next: string | null) => (day = next ?? today)}
			/>
		</div>
		<Button variant="ghost" onclick={() => (day = today)}
			>{t('app.field_ops_controller.today')}</Button
		>
	</Cluster>
{/snippet}

{#snippet card({ row }: { row: ListRow<'job_assignments'> })}
	<Stack gap="xs">
		<p class="line-clamp-2 text-sm leading-snug font-medium">
			{#if suspicious.has(row.id)}
				<Icon
					icon="lucide:shield-alert"
					class="inline size-3.5 text-warning"
					aria-label={t('component.suspicion_open')}
				/>
			{/if}
			{row.nature ?? row.title}
		</p>
		<p class="line-clamp-2 text-meta leading-snug">{siteName.get(row.site_id) ?? '—'}</p>
	</Stack>
{/snippet}

<AppShell
	icon="lucide:building-2"
	title={t('app.field_ops_controller.header_title')}
	description={t('app.field_ops_controller.header_description')}
>
	<Stack gap="sm" fill>
		<!-- the sheet picker the import action opens -->
		<input
			bind:this={picker}
			type="file"
			accept=".csv,text/csv,.xlsx"
			class="hidden"
			onchange={(event) => {
				const file = event.currentTarget.files?.[0];
				event.currentTarget.value = '';
				if (file) void importSheet(file);
			}}
		/>
		{#if open.error}<p class="text-sm text-destructive" role="alert">
				{t('app.field_ops_controller.review_status_failed')}
			</p>{/if}
		{#if message}<p role="status" class="text-sm whitespace-pre-line text-muted-foreground">
				{message}
			</p>{/if}
		<Split
			ratio="wide"
			collapse="switch"
			switchLabels={[t('app.field_ops_controller.tab_dispatch'), t('component.section_map')]}
			gap="md"
			fill
		>
			{#snippet start()}
				<Board
					of="job_assignments"
					by="status"
					key="dispatch"
					columns={2}
					where={{ scheduled_for: { eq: date } }}
					orderBy={{ dispatched_at: 'asc' }}
					toolbar={{
						controls: dayPicker,
						actions: [
							{
								icon: 'lucide:shield-alert',
								name: t('app.field_ops_controller.run_suspicion_review'),
								description: t('app.field_ops_controller.suspicion_review_description'),
								run: () => bolt.start('review_job_assignment_suspicion', {})
							},
							{
								icon: 'lucide:upload',
								name: t('app.field_ops_controller.import_assignments'),
								run: () => picker?.click(),
								disabled: () => (importing ? t('app.field_ops_controller.importing') : null)
							}
						]
					}}
					lanes={(['unassigned', 'assigned', 'completed'] as const).map((value) => ({
						value,
						label: statusLabel(value)
					}))}
					{card}
				/>
			{/snippet}
			{#snippet end()}
				<Stack gap="sm" fill>
					{#if mappedSites.length > 0}
						<!-- `isolate`: Leaflet's pane z-indexes stay below the record sheet -->
						<div class="isolate">
							<Map
								of="sites"
								at="location"
								label="name"
								where={{ id: { in: mappedSites } }}
								toolbar={{ new: false }}
							/>
						</div>
					{:else}
						<EmptyState variant="inset" title={t('app.field_ops_controller.map_empty', { date })} />
					{/if}
				</Stack>
			{/snippet}
		</Split>
	</Stack>
</AppShell>
