<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import {
		Combobox,
		Editor,
		EmptyState,
		Field,
		Form,
		Label,
		notify_outcome,
		RecordShell,
		Section,
		Table,
		Tabs,
		toast
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { LAW_DEPTH, lawsOf } from '../../../lib/law.js';
	import { patchOf } from '../../../lib/dated.js';
	import {
		isJsonObject,
		jsonObject,
		type Json,
		type JsonObject
	} from '../../../lib/payroll_engine/foundation.js';
	import LawBlock from '../../../lib/ui/settings/law_block.svelte';
	import LawChanges from '../../../lib/ui/settings/law_changes.svelte';
	import LawRow, { type LawRowTarget } from '../../../lib/ui/settings/law_row.svelte';
	import LawSave from '../../../lib/ui/settings/law_save.svelte';
	import { lawChain, lawWrites } from '../../../lib/ui/settings/law_save.js';
	import LawTable from '../../../lib/ui/settings/law_table.svelte';
	import CalculationOverview from './calculation_overview.svelte';
	import CatalogTabs from './catalog_tabs.svelte';
	import { jurisdictions } from './jurisdiction_scope.svelte.js';

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
	let researching = $state(false);
	function researchNow(code: string) {
		researching = true;
		fork(
			ctx.run('statutory_research', { code }).pipe(
				Effect.tap((outcome) => Effect.sync(() => notify_outcome(ctx, outcome))),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (researching = false)))
			)
		);
	}
	const blocks = [
		['conversions', 'settings_form.conversions'],
		['ledger', 'settings_form.ledger'],
		['work_regions', 'settings_form.work_regions'],
		['employee_statutory_parameters', 'settings_form.employee_schema'],
		['entity_statutory_parameters', 'settings_form.entity_schema']
	] as const;
	type Family = (typeof blocks)[number][0] | 'lookup';
	const CALENDAR = ['name', 'currency', 'timezone', 'tax_year_start_month'] as const;

	// a view's law blocks are drafts its one Save commits, with the jurisdiction's own fields, as one act
	let drafts = $state<Partial<Record<Family, Json>>>({});
	let always = $state(false);
	let changesOn = $state<string | null>(null);
	const block = (value: Json | undefined): JsonObject => (isJsonObject(value) ? value : {});
	const patchFor = (families: readonly Family[]): JsonObject => {
		if (law === undefined) return {};
		const held = law.settings;
		const pick = (of: (family: Family) => Json | undefined) =>
			Object.fromEntries(families.map((family) => [family, block(of(family))]));
		return patchOf(
			pick((family) => held[family]),
			pick((family) => drafts[family] ?? held[family]),
			LAW_DEPTH
		);
	};
	const FAMILIES: readonly Family[] = [...blocks.map(([family]) => family), 'lookup'];
	const patch = $derived(patchFor(FAMILIES));
	const acts = () => {
		if (law === undefined || Object.keys(patch).length === 0) return {};
		const writes = lawWrites(chain, law, patch, always ? null : (changesOn ?? law.on));
		return {
			'jurisdiction_change.create': writes.create,
			'jurisdiction_change.update': writes.update
		};
	};
	const reset = () => {
		drafts = {};
		always = false;
		changesOn = null;
	};
	const settled = (outcome: { kind: string }) => {
		if (outcome.kind === 'committed') reset();
	};
</script>

{#snippet inForce()}{#if law && Object.keys(patch).length > 0}<Combobox
			aria-label={ctx.t('law_save.title')}
			options={[
				{ value: 'from', label: ctx.t('law_save.from_date') },
				{ value: 'always', label: ctx.t('law_save.always') }
			]}
			value={always ? 'always' : 'from'}
			on_change={(next) => (always = next === 'always')}
		/>{#if !always}<Label for="law-effective-from">{ctx.t('law_save.date')}</Label><Editor
				{ctx}
				id="law-effective-from"
				name="effective_from"
				kind={{ kind: 'date' }}
				value={changesOn ?? law.on}
				on_change={(next) => next != null && (changesOn = String(next))}
			/>{/if}{/if}{/snippet}

{#snippet general()}{#if head}<Form
			{ctx}
			of="jurisdiction"
			id={head.id}
			fields={CALENDAR}
			{acts}
			on_outcome={settled}
			on_reset={reset}
		>
			<Stack gap="sm">
				<Section first name="settings_calendar" title={ctx.t('settings_form.calendar')}>
					<Grid minimum="card"
						>{#each CALENDAR as name (name)}<Field {ctx} {name} />{/each}</Grid
					>
				</Section>
				{#if law}
					{#each blocks as [family, title] (family)}
						<Section name="settings_{family}" title={ctx.t(title)} default_open={false}>
							<LawBlock {ctx} {law} {family} bind:draft={drafts[family]} />
						</Section>
					{/each}
				{/if}
			</Stack>
		</Form>{/if}{/snippet}

{#snippet changed()}<Scroll name={ctx.t('app.settings.changes')} size="fill" inset
		><LawChanges {ctx} {chain} today={clock.today} /></Scroll
	>{/snippet}

{#snippet research()}{#if head}<Table
			{ctx}
			of="statutory_finding"
			key="statutory_findings"
			where={{ jurisdiction_code: { eq: head.code }, status: { in: ['PROPOSED', 'CONFIRMED'] } }}
			toolbar={{
				new: true,
				title: ctx.t('app.settings.research'),
				actions: [
					{
						run: () => researchNow(head.code),
						icon: 'lucide:search',
						name: ctx.t('scheduled.research'),
						disabled: () => (researching ? ctx.t('component.loading') : null)
					}
				]
			}}
			columns={['title', 'fit', 'status', 'families', 'announced_on', 'source_urls']}
		/>{/if}{/snippet}

{#snippet changeLog()}<Tabs
		tabs={[
			{ name: 'changes', title: ctx.t('app.settings.changes'), body: changed },
			{ name: 'research', title: ctx.t('app.settings.research'), body: research }
		]}
	/>{/snippet}

{#snippet lookup()}{#if law && head}<Form
			{ctx}
			of="jurisdiction"
			id={head.id}
			fields={CALENDAR}
			{acts}
			on_outcome={settled}
			on_reset={reset}
		>
			<LawBlock {ctx} {law} family="lookup" bind:draft={drafts.lookup} />
		</Form>{/if}{/snippet}

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
	{#if head}{#key head.code}<RecordShell
				{ctx}
				of="jurisdiction"
				id={head.id}
				footer_actions={inForce}
				><Tabs
					tabs={[
						{
							name: 'general',
							title: ctx.t('app.settings.general'),
							body: general,
							keep_alive: true
						},
						{ name: 'lookup', title: ctx.t('app.settings.lookup'), body: lookup, keep_alive: true },
						{ name: 'overview', title: 'Calculation overview', body: overview },
						{ name: 'catalog', title: 'Catalog', body: catalog },
						{ name: 'rules', title: 'Registered rules', body: rules },
						{ name: 'behaviour', title: 'Registered behaviour', body: behaviour },
						{ name: 'change_log', title: ctx.t('app.settings.change_log'), body: changeLog }
					]}
				/></RecordShell
			>{/key}
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
