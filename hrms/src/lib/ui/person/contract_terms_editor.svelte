<script lang="ts" module>
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Kind } from '@norbital-ai/ui';
	import { PARAMETER_FIELDS, TERM_FIELDS } from '../../person.js';

	/** A family's dated fields as one value's kind, as the viewer's catalog declares them. */
	export const datedKind = (
		ctx: PageContext,
		of: 'contract_terms' | 'statutory_parameters'
	): Kind => {
		const declared = ctx.ui.kinds.catalog?.[of]?.fields ?? {};
		return {
			kind: 'object',
			fields: Object.fromEntries(
				(of === 'contract_terms' ? ['signed_on', ...TERM_FIELDS] : PARAMETER_FIELDS).flatMap(
					(name) => {
						const kind = declared[name];
						return kind === undefined ? [] : [[name, kind]];
					}
				)
			)
		};
	};
</script>

<script lang="ts">
	/**
	 * A person's terms or statutory parameters as one value, where they are written with their stint (a hire, a
	 * transfer): the categories offer the law's values, the allowances its catalogue, the jurisdiction parameters its
	 * schema.
	 */
	import {
		Editor,
		is_json_schema,
		json_schema_kind,
		type FieldEditor,
		type Value,
		value_object
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { Law } from '../../law.js';
	import { categoryValues } from './contract_categories.js';
	import AllowanceTermsEditor from './allowance_terms_editor.svelte';

	let {
		ctx,
		field,
		law
	}: {
		ctx: PageContext;
		field: Pick<FieldEditor, 'id' | 'name' | 'value' | 'kind' | 'disabled' | 'on_change'>;
		law: Law | undefined;
	} = $props();
	const categories = $derived(categoryValues(law));
	const own = $derived(field.kind.kind === 'object' ? field.kind.fields : {});
	const kind = $derived.by(() => {
		if (field.kind.kind !== 'object') return field.kind;
		const fields = { ...field.kind.fields };
		// the allowances are their own editor: a catalog combobox per row, not a free record
		delete fields['allowances'];
		for (const [name, values] of Object.entries(categories)) {
			const held = fields[name];
			if (values === undefined || held?.kind !== 'text') continue;
			fields[name] = {
				...(held.optional === true ? { optional: true as const } : {}),
				kind: 'enum',
				values
			};
		}
		const schema = law?.settings.employee_extension_schema;
		if (fields['parameters'] !== undefined && schema != null && is_json_schema(schema))
			fields['parameters'] = json_schema_kind(schema);
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
	const held = $derived(value_object(field.value) ? field.value : {});
	const allowances = $derived(held['allowances']);
	// the generic editor writes the value without allowances; keep what the custom editor holds
	const on_change = (next: Value) =>
		field.on_change({
			...(value_object(next) ? next : {}),
			...(allowances === undefined ? {} : { allowances })
		});
</script>

<Stack gap="sm">
	<Editor {ctx} {...field} {kind} {on_change} />
	{#if own['allowances'] !== undefined}
		<Stack gap="xs">
			<span class="text-sm font-medium">{ctx.t('contract.allowances')}</span>
			<AllowanceTermsEditor
				field={{
					id: `${field.id}-allowances`,
					disabled: field.disabled,
					value: allowances ?? null,
					on_change: (next) => field.on_change({ ...held, allowances: next })
				}}
				{law}
			/>
		</Stack>
	{/if}
</Stack>
