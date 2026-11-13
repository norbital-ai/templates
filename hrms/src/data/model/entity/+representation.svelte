<script lang="ts">
	/**
	 * A company: its plain fields, edited in place, and the timeline of its dated changes, newest first, under what is
	 * in force today. A timeline row shows its date and only what it changed, and opens its own record.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		EmptyState,
		Field,
		Form,
		open_record,
		RecordShell,
		Section,
		Sheet,
		StructuredData,
		Table,
		Tabs,
		format,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { COMPANY_FIELDS, companyOn } from '../../../lib/company.js';
	import { isJsonObject, jsonObject } from '../../../lib/payroll_engine/foundation.js';
	import VersionTimeline from '../../../lib/ui/components/version_timeline.svelte';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import VersionFacts from '../../../lib/ui/person/version_facts.svelte';

	let { view, ctx }: { view: RecordView<'entity'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const clock = ctx.clock('day');
	const laws = pageLaws(ctx, () => (record === null ? [] : [record.settings_code]));
	let adding = $state(false);
	const changes = $derived(
		record == null
			? null
			: ctx.query({ entity_change: { where: { entity_id: { eq: record.id } }, limit: 10000 } })
	);
	const rows = $derived((changes?.current?.entity_change.rows ?? []).map(jsonObject));
	const LABELS: Readonly<Record<string, Parameters<typeof t>[0]>> = {
		pay_methods: 'models.entity_change.fields.pay_methods',
		final_pay_loan_floor_percent: 'models.entity_change.fields.final_pay_loan_floor_percent',
		overtime_full_award_percent: 'models.entity_change.fields.overtime_full_award_percent',
		statutory_parameters: 'models.entity_change.fields.statutory_parameters'
	};
	const fieldLabel = (name: string) => {
		const key = LABELS[name];
		return key === undefined ? name : t(key);
	};
	/** Today's dated values under the names a change sets them by; a method no change has set is left out. */
	const inForce = $derived.by(() => {
		const { entity_extension_data, pay_methods, ...state } = companyOn(rows, clock.today);
		return {
			...(pay_methods == null ? {} : { pay_methods }),
			...state,
			statutory_parameters: entity_extension_data ?? {}
		};
	});
	/** What one change sets: a plain value beside its name, a record by the keys it holds; then what it takes away. */
	const summary = (row: (typeof rows)[number]): string =>
		[
			...COMPANY_FIELDS.flatMap((name) => {
				const value = row[name];
				if (value == null) return [];
				return [
					isJsonObject(value)
						? `${fieldLabel(name)} (${Object.keys(value).join(', ')})`
						: `${fieldLabel(name)}: ${String(value)}`
				];
			}),
			...(Array.isArray(row['clears']) ? row['clears'] : []).map(
				(name) => `${fieldLabel(String(name))}: ${t('law_changes.removed')}`
			)
		].join(' · ');
	const timeline = $derived(
		rows
			.map((row) => ({ row, from: String(row['effective_from']) }))
			.toSorted((left, right) => right.from.localeCompare(left.from))
			.map(({ row, from }) => ({
				id: String(row['id']),
				period: format({ kind: 'date' }, from, { locale: ctx.locale }),
				status: from > clock.today ? t('law_changes.upcoming') : t('app.settings.version_in_force'),
				detail: summary(row)
			}))
	);
</script>

{#snippet parameters(field: FieldEditor)}<VersionFacts
		{ctx}
		{field}
		law={laws.on(
			record?.settings_code,
			typeof field.form.values['effective_from'] === 'string'
				? field.form.values['effective_from']
				: clock.today
		)}
		subject="EMPLOYER"
	/>{/snippet}

{#snippet general()}
	<Form
		{ctx}
		of="entity"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		on_outcome={(outcome) => {
			if (outcome.kind !== 'committed' || record) return;
			const created = outcome.records.find((row) => row.model === 'entity');
			if (created) open_record('entity', created.id);
		}}
	>
		{#snippet children()}<Stack gap="md"
				>{#each ['code', 'name', 'settings_code', 'representative_name', 'registered_address', 'time_zone', 'bank', 'epf_registered_on', 'socso_registered_on'] as name (name)}<Field
						{ctx}
						{name}
					/>{/each}</Stack
			>{/snippet}
	</Form>
{/snippet}

{#snippet changesTab()}
	{#if record}
		<Stack gap="md">
			<Section name="entity_in_force" title={t('entity.in_force_today')} first collapsible={false}>
				<StructuredData {ctx} mode="view" value={inForce} />
			</Section>
			<Section
				name="entity_changes"
				title={t('app.settings.changes')}
				collapsible={false}
				actions={newChange}
			>
				{#if changes?.loading}
					<p class="text-meta">{t('component.loading')}</p>
				{:else if timeline.length === 0}
					<EmptyState title={t('entity.changes_empty')} />
				{:else}
					<VersionTimeline
						label={t('app.settings.changes')}
						items={timeline}
						onOpen={(id) => open_record('entity_change', id)}
					/>
				{/if}
			</Section>
		</Stack>
	{/if}
{/snippet}

{#snippet newChange()}<Button variant="outline" onclick={() => (adding = true)}
		>{t('entity.new_change')}</Button
	>{/snippet}

{#snippet holidaysTab()}
	{#if record}
		<Table
			{ctx}
			of="holiday"
			key="entity-holidays"
			where={{ entity_id: { eq: record.id } }}
			order_by={{ date: 'asc' }}
			toolbar={{ title: t('app.settings.holidays'), new: true }}
			columns={[
				'date',
				'name',
				'employee_id',
				{ field: 'published_at', label: t('calendar.published') }
			]}
		/>
	{/if}
{/snippet}

{#snippet payGroupsTab()}
	{#if record}
		<Table
			{ctx}
			of="pay_group"
			key="entity-pay-groups"
			where={{ entity_id: { eq: record.id } }}
			order_by={{ name: 'asc' }}
			toolbar={{ title: t('entity.tab_pay_groups'), new: true }}
			columns={['name', 'payment_schedule']}
		/>
	{/if}
{/snippet}

<RecordShell
	{ctx}
	of="entity"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}
		{@render general()}
	{:else}
		<Tabs
			tabs={[
				{ name: 'general', title: t('person.tab_general'), body: general },
				{ name: 'changes', title: t('app.settings.changes'), body: changesTab },
				{ name: 'pay_groups', title: t('entity.tab_pay_groups'), body: payGroupsTab },
				{ name: 'holidays', title: t('entity.tab_holidays'), body: holidaysTab }
			]}
		/>
	{/if}
</RecordShell>

{#if record !== null}
	<Sheet bind:open={adding} title={t('entity.new_change')}>
		<Form
			{ctx}
			of="entity_change"
			mode="create"
			values={{ entity_id: record.id }}
			on_outcome={(outcome) => {
				if (outcome.kind === 'committed') adding = false;
			}}
		>
			{#snippet children()}<Stack gap="md"
					>{#each ['effective_from', ...COMPANY_FIELDS] as name (name)}<Field
							{ctx}
							{name}
							{...name === 'statutory_parameters' ? { editor: parameters } : {}}
						/>{/each}</Stack
				>{/snippet}
		</Form>
	</Sheet>
{/if}
