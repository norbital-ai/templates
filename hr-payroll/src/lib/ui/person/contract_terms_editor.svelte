<script lang="ts">
	import { bolt } from '$bolt';
	import { Editor, type FieldEditor, type Value, valueObject } from '@norbital-ai/ui';
	import { idOf } from '../../payroll_engine/reads.js';
	import { contractCategories } from './contract_categories.js';
	import AllowanceTermsEditor from './allowance_terms_editor.svelte';

	let { field }: { field: FieldEditor } = $props();
	const versionId = $derived(field.form.values['input_schema_version_id']);
	const settings = $derived(
		typeof versionId === 'string'
			? bolt.query({
					jurisdiction_settings: {
						where: { id: { eq: idOf('jurisdiction_settings', versionId) } },
						fields: ['lookup'],
						limit: 1
					}
				})
			: null
	);
	const rule = $derived(
		typeof versionId === 'string'
			? bolt.query({
					registered_rule: {
						where: {
							settings_id: { eq: idOf('jurisdiction_settings', versionId) },
							code: { eq: 'CONTRACT_CATEGORIES' }
						},
						fields: ['lookup', 'validate'],
						limit: 1
					}
				})
			: null
	);
	const categories = $derived(
		contractCategories(
			settings?.current?.jurisdiction_settings.rows[0]?.lookup,
			rule?.current?.registered_rule.rows[0]?.lookup
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
		return { ...field.kind, fields };
	});
	const terms = $derived(valueObject(field.value) ? field.value : {});
	const allowances = $derived(terms['allowances']);
	const allowanceField: FieldEditor = $derived({
		...field,
		name: 'allowances',
		value: allowances ?? null,
		onChange: (next) => field.onChange({ ...terms, allowances: next })
	});
	// the generic editor writes the terms without allowances; keep what the custom editor holds
	const edited: FieldEditor = $derived({
		...field,
		kind,
		onChange: (next: Value) =>
			field.onChange({
				...(valueObject(next) ? next : {}),
				...(allowances === undefined ? {} : { allowances })
			})
	});
</script>

<div
	data-contract-terms
	data-categories={JSON.stringify(categories)}
	data-version={JSON.stringify(versionId)}
	data-version-type={typeof versionId}
>
	<Editor {...edited} />
	<div class="mt-2">
		<span class="text-sm font-medium">{bolt.t('contract.allowances')}</span>
		<AllowanceTermsEditor
			field={allowanceField}
			versionId={typeof versionId === 'string' ? versionId : undefined}
		/>
	</div>
</div>
