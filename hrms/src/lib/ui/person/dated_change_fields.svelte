<script lang="ts">
	/**
	 * The fields of one dated change to a stint, inside its form: its date, the terms or statutory parameters it
	 * changes, and what it takes away. The categories, allowances and jurisdiction parameters are those the law of the
	 * stint's company declares on the change's date.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Editor, Field, use_form, type FieldEditor } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { PARAMETER_FIELDS, TERM_FIELDS } from '../../person.js';
	import { idOf } from '../../payroll_engine/reads.js';
	import { pageLaws } from '../law.svelte.js';
	import AllowanceTermsEditor from './allowance_terms_editor.svelte';
	import { categoryValues } from './contract_categories.js';
	import VersionFacts from './version_facts.svelte';

	let { ctx, of }: { ctx: PageContext; of: 'contract_terms' | 'statutory_parameters' } = $props();
	const dated = $derived(of === 'contract_terms' ? TERM_FIELDS : PARAMETER_FIELDS);
	const names = $derived([
		'employment_id',
		'effective_from',
		...(of === 'contract_terms' ? ['signed_on'] : []),
		...dated,
		'clears'
	]);
	const form = use_form();
	const clock = ctx.clock('day');
	const stintId = $derived(form?.get('employment_id'));
	const stint = $derived(
		typeof stintId !== 'string'
			? null
			: ctx.query({
					employment: {
						where: { id: { eq: idOf('employment', stintId) } },
						fields: ['entity_id'],
						limit: 1,
						entity_id: { fields: ['settings_code'] }
					}
				})
	);
	const code = $derived(stint?.current?.employment.rows[0]?.entity_id?.settings_code);
	const laws = pageLaws(ctx, () => (code === undefined ? [] : [code]));
	const law = $derived.by(() => {
		const from = form?.get('effective_from');
		return laws.on(code, from == null ? clock.today : String(from).slice(0, 10));
	});
	const categories = $derived(categoryValues(law));
</script>

{#snippet category(field: FieldEditor)}<Editor
		{ctx}
		{...field}
		kind={{ kind: 'enum', values: categories[field.name] ?? [], optional: true }}
	/>{/snippet}
{#snippet allowances(field: FieldEditor)}<AllowanceTermsEditor {field} {law} />{/snippet}
{#snippet parameters(field: FieldEditor)}<VersionFacts
		{ctx}
		{field}
		{law}
		subject="EMPLOYEE"
	/>{/snippet}
{#snippet clears(field: FieldEditor)}<Editor
		{ctx}
		{...field}
		kind={{ kind: 'enum', values: [...dated], many: true, optional: true }}
	/>{/snippet}

<Stack gap="md">
	{#each names as name (name)}<Field
			{ctx}
			{name}
			{...name === 'allowances'
				? { editor: allowances }
				: name === 'parameters'
					? { editor: parameters }
					: name === 'clears'
						? { editor: clears }
						: categories[name] !== undefined
							? { editor: category }
							: {}}
		/>{/each}
</Stack>
