<script lang="ts">
	import { bolt } from '$bolt';
	import { Editor, isJsonSchema, jsonSchemaKind, type FieldEditor } from '@norbital-ai/ui';
	import { idOf } from '../../payroll_engine/reads.js';
	let {
		field,
		subject
	}: { field: FieldEditor; subject: 'EMPLOYEE' | 'EMPLOYER' | 'TERMS' | 'EXIT' } = $props();
	const versionId = $derived(field.form.values['input_schema_version_id']);
	const read = $derived(
		typeof versionId === 'string'
			? bolt.query({
					jurisdiction_settings: {
						where: { id: { eq: idOf('jurisdiction_settings', versionId) } },
						fields: ['employee_extension_schema', 'entity_extension_schema'],
						limit: 1
					}
				})
			: null
	);
	const stored = $derived(
		subject === 'EMPLOYER'
			? read?.current?.jurisdiction_settings.rows[0]?.entity_extension_schema
			: read?.current?.jurisdiction_settings.rows[0]?.employee_extension_schema
	);
	const schema = $derived(
		stored !== undefined && isJsonSchema(stored) ? stored : { type: 'object', properties: {} }
	);
	const kind = $derived(
		subject === 'TERMS' && field.kind.kind === 'object'
			? {
					...field.kind,
					fields: { ...field.kind.fields, employee_extension_data: jsonSchemaKind(schema) }
				}
			: { kind: 'json' as const }
	);
</script>

<Editor {...field} {kind} {...subject === 'TERMS' ? {} : { jsonSchema: schema }} />
