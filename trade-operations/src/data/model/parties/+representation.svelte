<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		EmptyState,
		Section,
		Table,
		Timeline,
		format,
		open_record,
		type RecordView,
		type TimelineEntry
	} from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
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
	const kingdeeFields = [
		'name',
		'external_code',
		'kind',
		'region',
		'currency',
		'phone',
		'active',
		'address'
	] as const;
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
					<EmptyState title={ctx.t('component.credit_snapshots_empty')} />
				{/snippet}
			</Timeline>
		</Section>
	{/if}{/snippet}
<RecordForm
	{ctx}
	after_form={credit}
	{view}
	readonly={!canClassify}
	readonly_reason={ctx.t('component.kingdee_readonly')}
	sections={[
		{
			name: 'partner',
			fields: [
				'name',
				'external_code',
				'kind',
				'region',
				'currency',
				'phone',
				'active',
				'related_party',
				'address'
			],
			readonlyFields: kingdeeFields,
			wide: ['address']
		},
		{
			name: 'sync',
			icon: 'lucide:refresh-cw',
			title: ctx.t('section.sync'),
			closed:
				view.mode === 'create'
					? ''
					: format({ kind: 'instant' }, view.record.source_updated_at, {
							locale: ctx.locale,
							...(ctx.tz == null ? {} : { zone: ctx.tz })
						}),
			fields: ['source_updated_at'],
			readonlyFields: ['source_updated_at']
		}
	]}
	tabs={[
		{ name: 'poc', title: ctx.t('component.poc'), body: contacts },
		{ name: 'orders', title: ctx.t('component.orders'), body: orders }
	]}
/>
