<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Combobox, Editor, EmptyState, Form, Section, Tabs } from '@norbital-ai/ui';
	import { lawsOf } from '../../../../lib/law.js';
	import { jsonObject, type JsonObject } from '../../../../lib/payroll_engine/foundation.js';
	import LawBlock from '../../../../lib/ui/settings/law_block.svelte';
	import LawChanges from '../../../../lib/ui/settings/law_changes.svelte';
	import LawRow, { type LawRowTarget } from '../../../../lib/ui/settings/law_row.svelte';
	import LawSave from '../../../../lib/ui/settings/law_save.svelte';
	import { lawChain } from '../../../../lib/ui/settings/law_save.js';
	import LawTable from '../../../../lib/ui/settings/law_table.svelte';
	import CalculationOverview from '../calculation_overview.svelte';
	import CatalogTabs from '../catalog_tabs.svelte';
	import { jurisdictions } from '../jurisdiction_scope.svelte.js';
	import VersionCompare from '../version_compare.svelte';

	let { ctx }: { ctx: PageContext } = $props();
	const all = jurisdictions(ctx);
	const clock = ctx.clock('day');
	let chosen = $state<string | null>(null);
	let picked = $state<string | null>(null);
	const day = $derived(picked ?? clock.today);
	const heads = $derived(all.current?.jurisdiction.rows ?? []);
	const head = $derived(heads.find((row) => row.code === chosen) ?? heads[0]);
	const read = $derived(head === undefined ? null : lawChain(ctx, head.code));
	const chain = $derived(read?.current?.jurisdiction_change.rows ?? []);
	const law = $derived(
		head === undefined
			? undefined
			: lawsOf({ jurisdiction: [jsonObject(head)], jurisdiction_change: chain.map(jsonObject) })(
					head.code,
					day
				)
	);

	let editing = $state<LawRowTarget | null>(null);
	let saving = $state<{ patch: JsonObject; done: () => void } | null>(null);
	const save = (patch: JsonObject, done: () => void) => {
		if (Object.keys(patch).length === 0) return done();
		saving = { patch, done };
	};
	const open = (target: LawRowTarget) => (editing = target);
	const blocks = [
		['conversions', 'settings_form.conversions'],
		['ledger', 'settings_form.ledger'],
		['work_regions', 'settings_form.work_regions'],
		['employee_extension_schema', 'settings_form.employee_schema'],
		['entity_extension_schema', 'settings_form.entity_schema']
	] as const;
</script>

{#snippet changes()}{#if head}<Scroll name={ctx.t('app.settings.changes')} size="fill" inset>
			<Stack gap="sm">
				<Section first name="settings_changes" title={ctx.t('app.settings.changes')}>
					<LawChanges {ctx} {chain} today={clock.today} />
				</Section>
				<Section
					name="settings_calendar"
					title={ctx.t('settings_form.calendar')}
					default_open={false}
				>
					<Form
						{ctx}
						of="jurisdiction"
						id={head.id}
						fields={['name', 'currency', 'timezone', 'tax_year_start_month']}
					/>
				</Section>
				{#if law}
					{#each blocks as [family, title] (family)}
						<Section name="settings_{family}" title={ctx.t(title)} default_open={false}>
							<LawBlock {ctx} {law} {family} {save} />
						</Section>
					{/each}
				{/if}
			</Stack>
		</Scroll>{/if}{/snippet}

{#snippet lookup()}{#if law}<Scroll name={ctx.t('app.settings.lookup')} size="fill" inset
			><LawBlock {ctx} {law} family="lookup" {save} /></Scroll
		>{/if}{/snippet}

{#snippet overview()}{#if law}<Scroll name="Calculation overview" size="fill" inset
			><CalculationOverview {ctx} {law} on_open={open} /></Scroll
		>{/if}{/snippet}

{#snippet catalog()}{#if law}<CatalogTabs {ctx} {law} on_open={open} />{/if}{/snippet}

{#snippet rules()}{#if law}<LawTable
			{ctx}
			name="rules"
			title="Registered rules"
			rows={law.rows.registered_rule}
			columns={[
				'description',
				'code',
				'target_collection',
				'events',
				{ field: 'reads', as: 'json' },
				{ field: 'condition', as: 'code' },
				{ field: 'validate', as: 'code' }
			]}
			on_open={(code) => open({ family: 'registered_rule', code })}
			on_new={() => open({ family: 'registered_rule', code: null })}
		/>{/if}{/snippet}

{#snippet behaviour()}{#if law}<LawTable
			{ctx}
			name="registered_effects"
			title="Registered behaviour"
			rows={law.rows.registered_effect}
			columns={[
				'description',
				'code',
				'name',
				'source_collection',
				'events',
				'target_collection',
				'target_action',
				{ field: 'condition', as: 'code' },
				{ field: 'effects', as: 'code' }
			]}
			on_open={(code) => open({ family: 'registered_effect', code })}
			on_new={() => open({ family: 'registered_effect', code: null })}
		/>{/if}{/snippet}

{#snippet compare()}<Scroll name={ctx.t('settings_version.compare')} size="fill" inset
		><VersionCompare {ctx} {chain} on={day} /></Scroll
	>{/snippet}

<AppShell
	title={ctx.t('app.settings.header_title')}
	description={ctx.t('v2.settings_help')}
	icon="lucide:settings-2"
	variant="full"
>
	{#snippet actions()}
		<div class="flex items-center gap-3">
			<Editor
				{ctx}
				name="law_on"
				kind={{ kind: 'date' }}
				value={day}
				on_change={(next) => (picked = next == null ? null : String(next))}
			/>
			<Combobox
				aria-label={ctx.t('app.settings.jurisdiction')}
				class="min-w-72"
				options={heads.map((row) => ({
					value: row.code,
					label: row.name,
					description: row.code,
					keywords: `${row.code} ${row.name}`
				}))}
				value={head?.code ?? null}
				on_change={(next) => (chosen = next)}
			/>
		</div>
	{/snippet}
	{#if head}{#key head.code}<Tabs
				tabs={[
					{ name: 'changes', title: ctx.t('app.settings.changes'), body: changes },
					{ name: 'lookup', title: ctx.t('app.settings.lookup'), body: lookup },
					{ name: 'overview', title: 'Calculation overview', body: overview },
					{ name: 'catalog', title: 'Catalog', body: catalog },
					{ name: 'rules', title: 'Registered rules', body: rules },
					{ name: 'behaviour', title: 'Registered behaviour', body: behaviour },
					{ name: 'compare', title: ctx.t('settings_version.compare'), body: compare }
				]}
			/>{/key}
	{:else}<EmptyState title={ctx.t('app.settings.choose_jurisdiction_empty')} />{/if}
</AppShell>

{#if law}
	<LawRow {ctx} {law} bind:target={editing} {save} />
	<LawSave
		{ctx}
		{law}
		{chain}
		bind:patch={() => saving?.patch ?? null, (next) => next === null && (saving = null)}
		on_saved={() => saving?.done()}
	/>
{/if}
