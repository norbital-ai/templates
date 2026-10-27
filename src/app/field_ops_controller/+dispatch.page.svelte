<script lang="ts">
	import { run, bolt } from '$bolt';
	import { Effect, Option, Schema } from 'effect';
	import { observe } from '@norbital-ai/ui/effect';
	import { watch } from 'runed';
	import type { ListRow } from '@norbital-ai/bolt';
	import { AppShell, Cluster, Split, Stack } from '@norbital-ai/ui/layout';
	import {
		Board,
		Button,
		TimeInput,
		EmptyState,
		Map,
		RunStatus,
		notifyOutcome
	} from '@norbital-ai/ui';
	import Icon from '@iconify/svelte';
	import { csvRecords } from '../../lib/csv.js';
	import { dayOf, getErrorMessage } from '../../lib/format.js';
	import { xlsxRecords } from '../../lib/xlsx.js';
	import { decodeWorkOrders } from '../../lib/work-order-sheet.js';
	class SheetFileUnavailable extends Schema.TaggedError<SheetFileUnavailable>()(
		'SheetFileUnavailable',
		{ message: Schema.String }
	) {}
	const t = bolt.t;
	/** Today in the workspace zone, rolling over at midnight. */
	const clock = bolt.clock('day');
	/** The day is in the URL, so opening a record (which re-renders the page) keeps it. */
	let day = $state<string>(new URL(location.href).searchParams.get('day') ?? clock.today);
	/** The day as a date; an unreadable one reads as today. */
	const date = $derived(dayOf(day) ?? clock.today);
	watch(
		() => day,
		() => {
			const url = new URL(location.href);
			if (url.searchParams.get('day') === day) return;
			url.searchParams.set('day', day);
			const state: unknown = history.state;
			history.replaceState(state, '', url);
		},
		{ lazy: false }
	);
	const jobs = $derived(
		bolt.query({
			job_assignments: {
				where: { scheduled_for: { eq: date } },
				fields: ['site_id'],
				limit: 1000
			}
		})
	);
	const dayJobs = $derived(jobs.current?.job_assignments.rows ?? []);
	const siteIds = $derived([...new Set(dayJobs.map((job) => job.site_id))]);
	const sites = $derived(
		siteIds.length === 0
			? null
			: bolt.query({
					sites: { where: { id: { in: siteIds } }, fields: ['name', 'location'], limit: 1000 }
				})
	);
	const siteName = $derived(
		new globalThis.Map((sites?.current?.sites.rows ?? []).map((site) => [site.id, site.name]))
	);
	const mappedSites = $derived(
		(sites?.current?.sites.rows ?? [])
			.filter((site) => site.location != null)
			.map((site) => site.id)
	);
	/** Read once for the board: which of the day's jobs carry a finding nobody has answered. */
	const open = $derived(
		dayJobs.length === 0
			? null
			: bolt.query({
					suspicious_activity_logs: {
						where: {
							resolved_at: { isNull: true },
							job_assignment_id: { in: dayJobs.map((job) => job.id) }
						},
						fields: ['job_assignment_id'],
						limit: 1000
					}
				})
	);
	const suspicious = $derived(
		new Set(
			(open?.current?.suspicious_activity_logs.rows ?? []).map((log) => log.job_assignment_id)
		)
	);
	const statusLabel = (status: 'pending' | 'completed') =>
		t(`component.status_${status}`);
	let message = $state<string | null>(null);
	let importing = $state(false);
	let picker = $state<HTMLInputElement>();
	let importRun = $state<{ id: string; file: string } | null>(null);
	const importRuns = observe(() =>
		importRun === null
			? null
			: bolt.runs('job_assignments_import_work_orders', {
					where: { id: { eq: importRun.id } },
					limit: 1
				})
	);
	const recordedImport = $derived(importRuns.current?.rows[0]);
	const importPending = $derived(
		importRun !== null &&
			importRuns.error === undefined &&
			(recordedImport === undefined ||
				recordedImport.status === 'queued' ||
				recordedImport.status === 'running')
	);
	const ImportOutput = Schema.Struct({
		created: Schema.Natural,
		sites: Schema.Natural,
		skipped: Schema.Natural
	});
	const importMessage = $derived.by(() => {
		if (importRun === null) return message;
		if (importRuns.error !== undefined) return getErrorMessage(importRuns.error);
		if (recordedImport?.status === 'failed' || recordedImport?.status === 'stopped')
			return recordedImport.error?.message ?? t('app.field_ops_controller.import_failed');
		if (recordedImport?.status !== 'succeeded') return message;
		const output = Schema.decodeUnknownOption(ImportOutput)(recordedImport.result);
		return Option.isSome(output)
			? t('app.field_ops_controller.import_done', {
					count: output.value.created,
					file: importRun.file
				})
			: t('app.field_ops_controller.import_failed');
	});
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
		const started = bolt.start('job_assignments_import_work_orders', {
			rows: yield* decodeWorkOrders(rows)
		});
		const outcome = yield* started;
		if (outcome.kind !== 'committed') {
			message =
				outcome.kind === 'refused' ? outcome.message : t('app.field_ops_controller.import_failed');
			notifyOutcome(bolt, outcome);
			return;
		}
		importRun = { id: outcome.output.id, file: file.name };
	});
	function importSheet(file: File): Promise<void> {
		importing = true;
		message = null;
		importRun = null;
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
				onChange={(next: string | null) => (day = next ?? clock.today)}
			/>
		</div>
		<Button variant="ghost" onclick={() => (day = clock.today)}
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
		{#if row.assignee_user_id == null}
			<p class="text-meta leading-snug text-warning">
				<Icon icon="lucide:user-x" class="inline size-3.5" aria-hidden="true" />
				{t('component.no_contractor')}
			</p>
		{/if}
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
		{#if open?.error}<p class="text-sm text-destructive" role="alert">
				{t('app.field_ops_controller.review_status_failed')}
			</p>{/if}
		{#if importMessage}<p role="status" class="text-sm whitespace-pre-line text-muted-foreground">
				{importMessage}
			</p>{/if}
		{#if importRun}
			<RunStatus
				automation="job_assignments_import_work_orders"
				run={recordedImport ?? importRun.id}
			/>
		{/if}
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
								disabled: () =>
									importing || importPending ? t('app.field_ops_controller.importing') : null
							}
						]
					}}
					lanes={(['pending', 'completed'] as const).map((value) => ({
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
