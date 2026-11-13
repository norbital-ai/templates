<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Editor, is_json_schema, json_schema_kind, type FieldEditor } from '@norbital-ai/ui';
	import { idOf } from '../../payroll_engine/reads.js';
	let {
		ctx,
		field,
		versionId,
		subject
	}: {
		ctx: PageContext;
		field: FieldEditor;
		/** The settings version in force for the record; a contract's is worked out from its entity and first day. */
		versionId: string | null;
		subject: 'EMPLOYEE' | 'EMPLOYER' | 'TERMS' | 'EXIT';
	} = $props();
	const read = $derived(
		typeof versionId === 'string'
			? ctx.query({
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
		stored !== undefined && is_json_schema(stored) ? stored : { type: 'object', properties: {} }
	);
	const kind = $derived(
		subject === 'TERMS' && field.kind.kind === 'object'
			? {
					...field.kind,
					fields: { ...field.kind.fields, employee_extension_data: json_schema_kind(schema) }
				}
			: { kind: 'json' as const }
	);
</script>

<Editor {ctx} {...field} {kind} {...subject === 'TERMS' ? {} : { jsonSchema: schema }} />
