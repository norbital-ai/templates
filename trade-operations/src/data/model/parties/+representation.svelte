<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		EmptyState,
		Field,
		RecordForm,
		Section,
		Table,
		Timeline,
		format,
		open_record,
		type RecordView,
		type TimelineEntry
	} from '@norbital-ai/ui';
	import { Grid, Stack, Surface } from '@norbital-ai/ui/layout';
	import {
		kingdeeIntegrationRead,
		workspaceKingdeeSummary
	} from '../../../integration/kingdee/connection-status.js';
	import { openCreate } from '../../../lib/ui/create-values.js';
	let {
		view,
		ctx
	}: {
		view: RecordView<'parties'>;
		ctx: PageContext;
	} = $props();
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const supplier = $derived(
		view.mode !== 'create' && ['supplier', 'both'].includes(view.record.kind)
	);
	const creditQuery = $derived(
		id && !supplier
			? ctx.query({
					credit_snapshots: {
						where: { party: { eq: id } },
						fields: [
							'currency',
							'credit_limit',
							'credit_used',
							'credit_available',
							'credit_hold',
							'as_of'
						],
						order_by: { as_of: 'desc' }
					}
				})
			: null
	);
	const creditEntries = $derived<TimelineEntry[]>(
		(creditQuery?.current?.credit_snapshots.rows ?? []).map((row, idx) => ({
			key: row.id,
			icon: row.credit_hold ? 'lucide:shield-alert' : 'lucide:landmark',
			tone: row.credit_hold ? 'danger' : idx === 0 ? 'brand' : 'default',
			title: format({ kind: 'instant' }, row.as_of, {
				locale: ctx.locale,
				...(ctx.tz == null ? {} : { zone: ctx.tz })
			}),
			line: [
				row.currency,
				...(row.credit_limit != null
					? [
							`${ctx.t('models.credit_snapshots.fields.credit_limit')}: ${format({ kind: 'money' }, row.credit_limit, { locale: ctx.locale, currency: row.currency })}`
						]
					: []),
				...(row.credit_used != null
					? [
							`${ctx.t('models.credit_snapshots.fields.credit_used')}: ${format({ kind: 'money' }, row.credit_used, { locale: ctx.locale, currency: row.currency })}`
						]
					: []),
				...(row.credit_available != null
					? [
							`${ctx.t('models.credit_snapshots.fields.credit_available')}: ${format({ kind: 'money' }, row.credit_available, { locale: ctx.locale, currency: row.currency })}`
						]
					: [])
			],
			...(row.credit_hold
				? {
						mark: {
							text: ctx.t('models.credit_snapshots.fields.credit_hold'),
							variant: 'destructive' as const
						}
					}
				: {}),
			onpick: () => open_record('credit_snapshots', row.id)
		}))
	);
	const canClassify = $derived(Boolean(ctx.catalog?.parties?.update));
	const kingdeeRead = $derived(
		ctx.catalog?.sys_integration ? ctx.query(kingdeeIntegrationRead) : null
	);
	const kingdeeSummary = $derived.by(() => {
		const rows = kingdeeRead?.current?.sys_integration.rows;
		if (!rows) return null;
		const sourceId = view.mode !== 'create' ? view.record.source : null;
		const matched = sourceId ? rows.filter((r) => r.id === sourceId) : rows;
		return workspaceKingdeeSummary(matched.length > 0 ? matched : rows);
	});
	const syncFailure = $derived(
		view.mode !== 'create' && view.record.$sync?.kingdee?.status === 'failed'
			? (view.record.$sync.kingdee.message ?? '')
			: null
	);
</script>

{#snippet contacts()}{#if id}<Table
			{ctx}
			of="contacts"
			where={{ party: { eq: id } }}
			columns={['name', 'email', 'phone', 'job_title', 'primary']}
			order_by={[{ primary: 'desc' }, { name: 'asc' }]}
			toolbar={{
				new: ctx.catalog?.contacts?.create ? () => openCreate('contacts', { party: id }) : false
			}}
		/>{/if}{/snippet}
{#snippet orders()}{#if id}<Table
			{ctx}
			of="orders"
			where={{ party: { eq: id } }}
			columns={['number', 'status', 'ordered_on', 'total']}
			toolbar={{ new: false }}
		/>{/if}{/snippet}

{#snippet credit()}{#if id && !supplier}
		<Section title={ctx.t('models.credit_snapshots.label')} icon="lucide:landmark">
			<Timeline entries={creditEntries} label={ctx.t('models.credit_snapshots.label')}>
				{#snippet empty()}
					<EmptyState
						title={ctx.t('component.credit_snapshots_empty')}
						{...kingdeeSummary && kingdeeSummary.state !== 'connected'
							? { description: ctx.t('component.kingdee_empty_connect_hint') }
							: {}}
					/>
				{/snippet}
			</Timeline>
		</Section>
	{/if}{/snippet}
<RecordForm
	{ctx}
	{view}
	{...canClassify ? {} : { lock: ctx.t('component.kingdee_readonly') }}
	tabs={[
		{ name: 'poc', title: ctx.t('component.poc'), body: contacts },
		{ name: 'orders', title: ctx.t('component.orders'), body: orders }
	]}
>
	<!-- Kingdee owns master fields; workspace profile and credit targets live locally and survive re-sync -->
	<Section first name="partner">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="name" readonly />
			<Field {ctx} name="external_code" readonly />
			<Field {ctx} name="source_number" readonly />
			<Field {ctx} name="kind" readonly />
			<Field {ctx} name="region" readonly />
			<Field {ctx} name="currency" readonly />
			<Field {ctx} name="phone" readonly />
			<Field {ctx} name="active" readonly />
			<Field {ctx} name="address" readonly wide />
		</Grid>
	</Section>
	<Section name="profile" icon="lucide:id-card" title={ctx.t('section.partner_profile')}>
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="related_party" />
			<Field {ctx} name="tax_id" />
			<Field {ctx} name="bank_name" />
			<Field {ctx} name="bank_account" />
			<Field {ctx} name="profile_notes" wide />
		</Grid>
	</Section>
	{#if id && !supplier}
		<Section
			name="credit_target"
			icon="lucide:sliders-horizontal"
			title={ctx.t('section.credit_limit_adjustment')}
		>
			<Stack gap="sm">
				<p class="text-xs text-muted-foreground">
					{ctx.t('component.credit_limit_adjustment_help')}
				</p>
				{#if kingdeeSummary && kingdeeSummary.state !== 'connected'}
					<Surface tone="subtle" padding="sm" radius="control">
						<p class="text-xs text-muted-foreground">
							{ctx.t('component.credit_limit_kingdee_disconnected')}
						</p>
					</Surface>
				{:else if kingdeeSummary && !kingdeeSummary.directCreditWrite}
					<Surface tone="subtle" padding="sm" radius="control">
						<p class="text-xs text-muted-foreground">
							{ctx.t('component.credit_limit_direct_write_off')}
						</p>
					</Surface>
				{/if}
				{#if syncFailure}
					<Surface tone="subtle" padding="sm" radius="control">
						<p class="text-xs text-destructive">{syncFailure}</p>
					</Surface>
				{/if}
				<Grid gap="md" minimum="compact">
					<Field {ctx} name="credit_limit_target" />
					<Field {ctx} name="credit_days_target" />
				</Grid>
			</Stack>
		</Section>
	{/if}
	<Section
		name="sync"
		icon="lucide:refresh-cw"
		title={ctx.t('section.sync')}
		default_open={false}
		summary={view.mode === 'create'
			? ''
			: format({ kind: 'instant' }, view.record.source_updated_at, {
					locale: ctx.locale,
					...(ctx.tz == null ? {} : { zone: ctx.tz })
				})}
	>
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="source_updated_at" readonly />
		</Grid>
	</Section>
	{@render credit()}
</RecordForm>
