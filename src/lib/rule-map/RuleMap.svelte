<script lang="ts">
	/** A chosen payroll item: required inputs, stored calculations and downstream payroll effects. */
	import { t } from '../ui/t.js';
	import { bolt } from '$bolt';
	import { Button, Combobox } from '@norbital-ai/ui';
	import InfoTip from '../ui/InfoTip.svelte';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { live, liveRows } from '../ui/live.svelte.js';
	import { everyField } from '../every-field.js';
	import { adjacent, CATALOGUE_COLLECTIONS, reach, ruleMap, type RuleNode } from './graph.js';

	let {
		version
	}: {
		readonly version: {
			readonly id: Id<'jurisdiction_settings'>;
			readonly code: string;
			readonly jurisdiction_code: string;
		};
	} = $props();

	const record = live(() =>
		bolt.get('jurisdiction_settings', version.id, everyField('jurisdiction_settings'))
	);
	const where = $derived({ settings_id: { eq: version.id }, approval_id: { isNull: true } });
	const schemes = liveRows(() =>
		bolt.read('statutory_contributions', {
			where,
			select: everyField('statutory_contributions'),
			all: true
		})
	);
	const catalogueReads = CATALOGUE_COLLECTIONS.map((collection) => ({
		collection,
		rows: liveRows(() =>
			bolt.read(collection, { where, select: everyField(collection), all: true } as never)
		)
	}));

	const map = $derived(
		record.current == null
			? null
			: ruleMap({
					version: record.current,
					schemes: schemes.current ?? [],
					catalogues: Object.fromEntries(
						catalogueReads.map(({ collection, rows }) => [collection, rows.current ?? []])
					)
				})
	);
	const loading = $derived(
		record.loading || schemes.loading || catalogueReads.some(({ rows }) => rows.loading)
	);
	const error = $derived(
		record.error ?? schemes.error ?? catalogueReads.find(({ rows }) => rows.error)?.rows.error
	);
	const byId = $derived(new Map((map?.nodes ?? []).map((node) => [node.id, node])));

	let selected = $state<string | null>(null);
	const chosen = $derived(selected == null ? null : (byId.get(selected) ?? null));
	const upstream = $derived(
		map == null || selected == null ? new Set<string>() : reach(map, selected, 'up')
	);
	const downstream = $derived(
		map == null || selected == null ? new Set<string>() : reach(map, selected, 'down')
	);
	const choices = $derived(
		(map?.nodes ?? []).filter(
			(node) => node.kind === 'line' || node.kind === 'scheme' || node.kind === 'check'
		)
	);
	const supporting = $derived(
		map == null || chosen == null
			? []
			: adjacent(map, chosen.id, 'up').flatMap((id) => {
					const node = byId.get(id);
					return node != null &&
						node.expressions.length > 0 &&
						(node.kind === 'rule' || node.kind === 'base' || node.kind === 'scheme')
						? [node]
						: [];
				})
	);
	const inputs = $derived(
		(map?.nodes ?? []).filter(
			(node) =>
				upstream.has(node.id) &&
				(node.kind === 'fact' || node.kind === 'input' || node.kind === 'table')
		)
	);
	const affects = $derived(
		(map?.nodes ?? []).filter(
			(node) =>
				downstream.has(node.id) &&
				(node.kind === 'line' ||
					node.kind === 'base' ||
					node.kind === 'scheme' ||
					node.kind === 'payslip')
		)
	);
	const explanation = (node: RuleNode) => node.description ?? t(`component.rule_help.${node.kind}`);
	const expressionHelp = (field: string) => {
		const keys = {
			when: 'component.formula_help.when',
			eligibility: 'component.formula_help.when',
			amount: 'component.formula_help.amount',
			price_amount: 'component.formula_help.amount',
			time_off_amount: 'component.formula_help.leave_target',
			pay_fraction: 'component.formula_help.leave_fraction',
			employee: 'component.flow_rule_employee_help',
			employer: 'component.flow_rule_employer_help',
			assessed_on: 'component.flow_inputs_help',
			take_hours: 'renderer.work_rules.column_take_hours_help',
			required_when: 'component.formula_help.required',
			default: 'component.formula_help.default'
		} as const;
		const name = field
			.split(/[.\[\]]/)
			.filter(Boolean)
			.at(-1);
		return t(
			name != null && name in keys
				? keys[name as keyof typeof keys]
				: 'component.rule_expression_help'
		);
	};
</script>

{#snippet item(node: RuleNode)}
	<Inline gap="xs" align="center" class="border-b border-border py-2">
		{#if choices.some((choice) => choice.id === node.id)}
			<Button
				variant="ghost"
				size="sm"
				class="h-auto min-w-0 whitespace-normal text-left"
				onclick={() => (selected = node.id)}
				data-rule-node={node.id}>{node.label}</Button
			>
		{:else}
			<span class="min-w-0 text-sm break-words">{node.label}</span>
		{/if}
		<InfoTip label={node.label}>{explanation(node)}</InfoTip>
	</Inline>
{/snippet}

{#if error}
	<p role="alert" class="text-destructive">{error}</p>
{:else if loading}
	<p role="status" class="text-meta">{t('component.rule_loading')}</p>
{:else}
	<Stack gap="md" data-rule-map>
		<p class="max-w-prose text-sm text-muted-foreground">{t('component.rule_purpose')}</p>
		<Inline gap="xs" align="center">
			<h3 class="font-medium">{t('component.rule_choose')}</h3>
			<InfoTip label={t('component.rule_choose')}>{t('component.rule_choose_help')}</InfoTip>
		</Inline>
		<Combobox
			value={selected}
			options={choices.map((node) => ({ value: node.id, label: node.label }))}
			placeholder={t('component.rule_choose')}
			aria-label={t('component.rule_choose')}
			clearable
			onChange={(value) => (selected = value)}
		/>
		{#if chosen && map}
			<section data-rule-detail>
				<Inline gap="xs" align="center">
					<h3 class="font-medium">{chosen.label}</h3>
					<InfoTip label={chosen.label}>{explanation(chosen)}</InfoTip>
				</Inline>
				<Grid minimum="card" gap="lg">
					<Stack gap="xs">
						<h4 class="text-sm font-medium">{t('component.rule_needed')}</h4>
						{#each inputs as node (node.id)}{@render item(node)}{/each}
						{#if inputs.length === 0}<p class="text-meta">{t('component.rule_no_inputs')}</p>{/if}
					</Stack>
					<Stack gap="sm">
						<h4 class="text-sm font-medium">{t('component.rule_calculation')}</h4>
						<details>
							<summary class="text-sm">{t('component.rule_view_formulas')}</summary>
							<Stack gap="sm" class="pt-2">
								{#each chosen.expressions as entry, index (index)}
									<div class="border-b border-border pb-2">
										<Inline gap="xs" align="center">
											<span class="text-xs font-medium">{entry.field}</span>
											<InfoTip label={entry.field}>{expressionHelp(entry.field)}</InfoTip>
										</Inline>
										<code class="block text-xs break-words whitespace-pre-wrap"
											>{entry.expression}</code
										>
									</div>
								{/each}
							</Stack>
						</details>
						{#each supporting as node (node.id)}
							<details class="border-b border-border pb-2" data-rule-support={node.id}>
								<summary class="text-sm font-medium">{node.label}</summary>
								<Stack gap="xs" class="pt-2">
									{#each node.expressions as entry, index (index)}
										<div>
											<Inline gap="xs" align="center"
												><span class="text-xs font-medium">{entry.field}</span><InfoTip
													label={entry.field}>{expressionHelp(entry.field)}</InfoTip
												></Inline
											>
											<code class="block text-xs break-words whitespace-pre-wrap"
												>{entry.expression}</code
											>
										</div>
									{/each}
								</Stack>
							</details>
						{/each}
						{#if chosen.authority}<details class="text-xs">
								<summary>{t('component.rule_map_citation')}</summary>
								<p class="pt-2 whitespace-pre-wrap">{chosen.authority}</p>
							</details>{/if}
					</Stack>
					<Stack gap="xs">
						<h4 class="text-sm font-medium">{t('component.rule_affects')}</h4>
						{#each affects as node (node.id)}{@render item(node)}{/each}
						{#if affects.length === 0}<p class="text-meta">{t('component.rule_no_effects')}</p>{/if}
					</Stack>
				</Grid>
			</section>
		{:else}
			<p class="text-meta">{t('component.rule_choose_empty')}</p>
		{/if}
	</Stack>
{/if}
