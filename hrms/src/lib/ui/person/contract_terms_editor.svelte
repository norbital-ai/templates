<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Editor, type FieldEditor, type Value, value_object } from '@norbital-ai/ui';
	import type { Law } from '../../law.js';
	import { contractCategories } from './contract_categories.js';
	import AllowanceTermsEditor from './allowance_terms_editor.svelte';

	let { ctx, field, law }: { ctx: PageContext; field: FieldEditor; law: Law | undefined } =
		$props();
	const categories = $derived(
		contractCategories(
			law?.settings.lookup,
			law?.rows.registered_rule.find((row) => row.code === 'CONTRACT_CATEGORIES')?.lookup
		)
	);
	const kind = $derived.by(() => {
		if (field.kind.kind !== 'object') return field.kind;
		const fields = { ...field.kind.fields };
		// the allowances are their own editor: a catalog combobox per row, not a free record
		delete fields['allowances'];
		const set = (name: string, values: readonly string[] | undefined) => {
			const held = fields[name];
			if (values === undefined || held?.kind !== 'text') return;
			fields[name] = {
				...(held.optional === true ? { optional: true as const } : {}),
				...(held.help === undefined ? {} : { help: held.help }),
				...(held.label === undefined ? {} : { label: held.label }),
				kind: 'enum',
				values
			};
		};
		set('residency_status', categories.residency);
		set('statutory_work_category', categories.statutory);
		set('work_authorisation_category', categories.pass);
		set('work_classification', categories.classification);
		// the employee-borne tax items are the agreed allowances
		const items = fields['employee_borne_tax_items'];
		const agreed =
			value_object(field.value) && value_object(field.value['allowances'])
				? Object.keys(field.value['allowances'])
				: [];
		if (items?.many === true && agreed.length > 0)
			fields['employee_borne_tax_items'] = { kind: 'enum', values: agreed, many: true };
		return { ...field.kind, fields };
	});
	const terms = $derived(value_object(field.value) ? field.value : {});
	const allowances = $derived(terms['allowances']);
	const allowanceField: FieldEditor = $derived({
		...field,
		name: 'allowances',
		value: allowances ?? null,
		on_change: (next) => field.on_change({ ...terms, allowances: next })
	});
	// the generic editor writes the terms without allowances; keep what the custom editor holds
	const edited: FieldEditor = $derived({
		...field,
		kind,
		on_change: (next: Value) =>
			field.on_change({
				...(value_object(next) ? next : {}),
				...(allowances === undefined ? {} : { allowances })
			})
	});
</script>

<div data-contract-terms data-categories={JSON.stringify(categories)}>
	<Editor {ctx} {...edited} />
	<div class="mt-2">
		<span class="text-sm font-medium">{ctx.t('contract.allowances')}</span>
		<AllowanceTermsEditor field={allowanceField} {law} />
	</div>
</div>
