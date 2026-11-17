<script lang="ts">
	/**
	 * A company: its plain fields and, beside them, what changes by date (pay methods, the two percentages and the
	 * statutory parameters its law declares), shown as in force on a day and edited in place. Saving writes what
	 * differs from that day: on the change already dated that day, else on a new one. One Save for the view.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Field,
		Form,
		label,
		open_record,
		RecordShell,
		Section,
		Table,
		Tabs,
		type RecordView
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { COMPANY_FIELDS } from '../../../lib/company.js';
	import { factWrites, factsOf, type Fact } from '../../../lib/dated_facts.js';
	import { jsonObject } from '../../../lib/payroll_engine/foundation.js';
	import DatedFacts from '../../../lib/ui/components/dated_facts.svelte';
	import { declaredParameters } from '../../../lib/ui/components/parameter_facts.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { scheduleSummary } from '../../../lib/ui/payroll/schedule_summary.js';

	let { view, ctx }: { view: RecordView<'entity'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const clock = ctx.clock('day');
	const laws = pageLaws(ctx, () => (record === null ? [] : [record.settings_code]));
	const changes = $derived(
		record == null
			? null
			: ctx.query({ entity_change: { where: { entity_id: { eq: record.id } }, limit: 10000 } })
	);
	const rows = $derived((changes?.current?.entity_change.rows ?? []).map(jsonObject));
	const own = COMPANY_FIELDS.filter(
		(name) => name !== 'statutory_parameters' && name !== 'pay_methods'
	);
	const shape = { fields: own, record: 'statutory_parameters', keyed: ['pay_methods'] };
	let draft = $state<readonly Fact[] | null>(null);
	const facts = $derived(draft ?? factsOf(rows, shape));
	const fields = $derived(ctx.ui.kinds.catalog?.['entity_change']?.fields ?? {});
	// each pay method is a fact of its own
	const methods = $derived(
		fields['pay_methods']?.kind === 'object' ? fields['pay_methods'].fields : {}
	);
	// a parameter is the one the company's law declares on the fact's own day
	const declared = (day: string) =>
		declaredParameters(
			laws.on(record?.settings_code, day === '' ? clock.today : day)?.settings
				.entity_statutory_parameters
		);
	const names = $derived([
		...[...Object.keys(methods).map((key) => `pay_methods.${key}`), ...own].map((value) => ({
			value,
			label: label(ctx, 'entity_change', value)
		})),
		...Object.entries(declared(clock.today)).map(([value, { label }]) => ({ value, label }))
	]);
	const kindOf = (fact: Fact) => {
		const method = fact.name.startsWith('pay_methods.')
			? methods[fact.name.slice('pay_methods.'.length)]
			: undefined;
		const field =
			method ?? (own.some((name) => name === fact.name) ? fields[fact.name] : undefined);
		return field === undefined ? declared(fact.from)[fact.name] : { kind: field };
	};
	const acts = () => {
		if (record === null || draft === null) return {};
		const writes = factWrites(rows, draft, { entity_id: record.id }, shape);
		return Object.fromEntries(
			(['create', 'update', 'delete'] as const).flatMap((verb) =>
				writes[verb].length === 0 ? [] : [[`entity_change.${verb}`, writes[verb]]]
			)
		);
	};
</script>

{#snippet general()}
	<Form
		{ctx}
		of="entity"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		{acts}
		on_outcome={(outcome) => {
			if (outcome.kind !== 'committed') return;
			draft = null;
			if (record) return;
			const created = outcome.records.find((row) => row.model === 'entity');
			if (created) open_record('entity', created.id);
		}}
	>
		{#snippet children()}<Stack gap="md"
				>{#each ['code', 'name', 'settings_code', 'representative_name', 'registered_address', 'time_zone', 'bank'] as name (name)}<Field
						{ctx}
						{name}
					/>{/each}
				{#if record}
					<Section name="entity_dated" title={t('dated.title')} collapsible={false}>
						<Stack gap="sm">
							<p class="text-meta">{t('dated.hint')}</p>
							<DatedFacts
								{ctx}
								id="entity-facts"
								of="entity_change"
								{facts}
								base={factsOf(rows, shape)}
								{names}
								{kindOf}
								onchange={(next) => (draft = next)}
							/>
						</Stack>
					</Section>
				{/if}</Stack
			>{/snippet}
	</Form>
{/snippet}

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
			columns={['name', { field: 'payment_schedule', cell: schedule }]}
		/>
	{/if}
{/snippet}

{#snippet schedule({ value }: { value: unknown })}{scheduleSummary(ctx, value)}{/snippet}

{#snippet shiftsTab()}
	{#if record}
		<Table
			{ctx}
			of="shift_definition"
			key="entity-shifts"
			where={{ entity_id: { eq: record.id } }}
			order_by={{ code: 'asc' }}
			toolbar={{ title: t('entity.tab_shifts'), new: true }}
			columns={['code', 'name', 'effective_range']}
		/>
	{/if}
{/snippet}

{#snippet shiftPatternsTab()}
	{#if record}
		<Table
			{ctx}
			of="shift_pattern"
			key="entity-shift-patterns"
			where={{ entity_id: { eq: record.id } }}
			order_by={{ code: 'asc' }}
			toolbar={{ title: t('entity.tab_shift_patterns'), new: true }}
			columns={['code', 'name', 'effective_range']}
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
				{ name: 'pay_groups', title: t('entity.tab_pay_groups'), body: payGroupsTab },
				{ name: 'shifts', title: t('entity.tab_shifts'), body: shiftsTab },
				{ name: 'shift_patterns', title: t('entity.tab_shift_patterns'), body: shiftPatternsTab },
				{ name: 'holidays', title: t('entity.tab_holidays'), body: holidaysTab }
			]}
		/>
	{/if}
</RecordShell>
