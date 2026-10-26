<script lang="ts">
	/**
	 * One statutory contribution scheme: its identity and legal summary, then its configuration by topic — how the wage
	 * is assessed, who it applies to, the guards that stop or warn a payslip, its rates, and the annual reconciliation
	 * (closed). Every section shows and writes its own keys of the one `configuration` object and keeps the rest.
	 */
	import { bolt } from '$bolt';
	import type { MessageKey } from '@norbital-ai/bolt';
	import {
		Field,
		Form,
		openRecord,
		RecordShell,
		Section,
		type Kind,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';
	import JsonFields from '../../../lib/ui/settings/json_fields.svelte';
	import { labelled, tabled } from '../../../lib/ui/settings/labelled.js';

	let { view }: { view: RecordView<'statutory_contribution_catalog'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;

	const CONFIGURATION = STATUTORY_FIELDS.statutory_contribution_catalog.configuration.shape.fields;
	type ConfigurationKey = keyof typeof CONFIGURATION;
	const kindOf = (key: ConfigurationKey) =>
		tabled(
			labelled(bolt, 'statutory_contribution_catalog', `configuration.${key}`, CONFIGURATION[key])
		);
	const SECTIONS = [
		{
			name: 'assessment',
			title: 'section.assessment',
			open: true,
			keys: [
				'assessment',
				'assessable',
				'assess_without_wage',
				'carry_uncovered',
				'governed_by',
				'as_of',
				'order'
			]
		},
		{ name: 'applies_to', title: 'section.who_it_applies_to', open: true, keys: ['person'] },
		{ name: 'guards', title: 'section.guards', open: true, keys: ['refuse_when', 'warn_when'] },
		{ name: 'rates', title: 'section.rates', open: true, keys: ['rules'] },
		{
			name: 'annual_reconciliation',
			title: 'section.annual_reconciliation',
			open: false,
			keys: ['annual_reconciliation']
		}
	] as const satisfies readonly {
		name: string;
		title: MessageKey;
		open: boolean;
		keys: readonly ConfigurationKey[];
	}[];
	const sections = SECTIONS.map((section) => ({
		...section,
		kinds: Object.fromEntries(section.keys.map((key) => [key, kindOf(key)]))
	}));
	// the legal summary is prose: a textarea, not a one-line input
	const LIMITATION = {
		limitation: labelled(bolt, 'statutory_contribution_catalog', 'configuration.limitation', {
			...CONFIGURATION.limitation,
			max: 100_000
		})
	};
</script>

{#snippet configuration(kinds: Readonly<Record<string, Kind>>)}
	<Field name="configuration" label="" help="">
		{#snippet view(field)}
			<JsonFields readonly value={field.value} {kinds} name={field.name} id={field.id} />
		{/snippet}
		{#snippet editor(field)}
			<JsonFields
				value={field.value}
				onChange={field.onChange}
				{kinds}
				name={field.name}
				id={field.id}
				disabled={field.disabled}
			/>
		{/snippet}
	</Field>
{/snippet}

<RecordShell
	of="statutory_contribution_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="statutory_contribution_catalog"
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find(
					(row) => row.collection === 'statutory_contribution_catalog'
				);
				if (created) openRecord('statutory_contribution_catalog', created.id);
			}}
		>
			{#snippet children()}
				<Section first name="identity" title={t('section.identity')}>
					<Stack gap="md">
						<Grid minimum="card">
							<Field name="code" />
							<Field name="name" />
							<Field name="label" />
							<Field name="display_order" />
						</Grid>
						<Field name="references" />
						{@render configuration(LIMITATION)}
					</Stack>
				</Section>
				{#each sections as section (section.name)}
					<Section name={section.name} title={t(section.title)} defaultOpen={section.open}>
						{@render configuration(section.kinds)}
					</Section>
				{/each}
			{/snippet}
		</Form>
	{/key}
</RecordShell>
