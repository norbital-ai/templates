<script lang="ts">
	import { bolt } from '$bolt';
	import { Editor, type FieldEditor } from '@norbital-ai/ui';
	import { idOf } from '../../payroll_engine/reads.js';
	import { contractCategories } from './contract_categories.js';

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
</script>

<div
	data-contract-terms
	data-categories={JSON.stringify(categories)}
	data-version={JSON.stringify(versionId)}
	data-version-type={typeof versionId}
>
	<Editor {...field} {kind} />
</div>
