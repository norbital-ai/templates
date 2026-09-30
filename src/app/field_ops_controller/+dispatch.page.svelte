<script lang="ts">
	/**
	 * The dispatch day: the day's jobs on a board by status (a drop is the status write), the day's sites on a map, an open
	 * suspicion marked on the board, the suspicion review's manual start and the
	 * work-order sheet import.
	 */
	import { bolt } from '$bolt';
	import type { ListRow } from '@norbital-ai/bolt';
	import { AppShell, Cluster, Split, Stack } from '@norbital-ai/ui/layout';
	import { Board, Button, DateInput, EmptyState, Map, useKinds } from '@norbital-ai/ui';
	import Icon from '@iconify/svelte';
	import { csvRecords } from '../../lib/csv.js';
	import { live } from '../../lib/live.svelte.js';
	import { dayIn, dayOf, getErrorMessage } from '../../lib/format.js';
	import { xlsxRecords } from '../../lib/xlsx.js';

	const t = bolt.t;
	const today = dayIn(useKinds().zone);
	/** The day is in the URL, so opening a record (which re-renders the page) keeps it. */
	let day = $state<string>(new URL(location.href).searchParams.get('day') ?? today);
	/** The day as a date; an unreadable one reads as today. */
	const date = $derived(dayOf(day) ?? today);
	$effect(() => {
		const url = new URL(location.href);
		if (url.searchParams.get('day') === day) return;
		url.searchParams.set('day', day);
		history.replaceState(history.state, '', url);
	});

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
					select: { name: true },
					limit: 1000
				})
	);
	const siteName = $derived(
		new globalThis.Map((sites.current?.rows ?? []).map((site) => [site.id, site.name]))
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
	async function importSheet(file: File) {
		importing = true;
		message = null;
		try {
			const rows = /\.xlsx$/i.test(file.name)
				? await xlsxRecords(await file.arrayBuffer())
				: csvRecords(await file.text());
			if (rows.length === 0) {
				message = t('app.field_ops_controller.import_empty', { file: file.name });
				return;
			}
			const outcome = await bolt.act('job_assignments.import_work_orders', {
				rows: rows.map((r) => ({
					site: r['site'] ?? '',
					scheduled_for: r['scheduled_for'] ?? '',
					title: r['title'] ?? '',
					postal_code: r['postal_code'] ?? null,
					nature: r['nature'] ?? null,
					description: r['description'] ?? null,
					assignee_user_id: r['assignee_user_id'] ?? null,
					external_ref: r['external_ref'] ?? null
				}))
			});
			message =
				outcome.kind === 'committed'
					? t('app.field_ops_controller.import_done', {
							count: outcome.output.created,
							file: file.name
						})
					: outcome.kind === 'refused'
						? outcome.message
						: t('app.field_ops_controller.import_failed');
		} catch (error) {
			message = getErrorMessage(error);
		} finally {
			importing = false;
		}
	}
</script>

{#snippet dayPicker()}
	<Cluster gap="xs" align="center">
		<label class="sr-only" for="dispatch-day"
			>{t('app.field_ops_controller.select_dispatch_date')}</label
		>
		<div class="w-40">
			<DateInput id="dispatch-day" value={day} onChange={(next) => (day = next ?? today)} />
		</div>
		<Button variant="ghost" size="sm" onclick={() => (day = today)}
			>{t('app.field_ops_controller.today')}</Button
		>
	</Cluster>
{/snippet}

{#snippet card({ row }: { row: ListRow<'job_assignments'> })}
	<Stack gap="xs">
		<!-- the nature, not the title: a title is "<nature> — <site>", which the line below already says -->
		<p class="line-clamp-2 text-sm leading-snug font-medium">
			{#if suspicious.has(row.id)}
				<Icon
					icon="lucide:shield-alert"
					class="inline size-3.5 text-warning"
					aria-label={t('component.suspicion_open')}
				/>
			{/if}
			{row.nature ?? '—'}
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
		<Split ratio="wide" collapse="switch" gap="md" fill>
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
								start: 'review_job_assignment_suspicion',
								input: () => ({}),
								icon: 'lucide:shield-alert',
								label: t('app.field_ops_controller.run_suspicion_review'),
								description: t('app.field_ops_controller.suspicion_review_description')
							},
							{
								run: () => picker?.click(),
								group: 'import',
								icon: 'lucide:upload',
								label: t('app.field_ops_controller.import_assignments'),
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
					<!-- `isolate`: Leaflet's pane z-indexes stay below the record sheet -->
					<div class="isolate">
						<Map
							of="sites"
							at="location"
							label="name"
							where={{ id: { in: siteIds } }}
							toolbar={{ new: false }}
						/>
					</div>
					{#if siteIds.length === 0}
						<EmptyState variant="inset" title={t('app.field_ops_controller.map_empty', { date })} />
					{/if}
				</Stack>
			{/snippet}
		</Split>
	</Stack>
</AppShell>
