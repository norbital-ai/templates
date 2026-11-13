<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Editor, is_json_schema, json_schema_kind, type FieldEditor } from '@norbital-ai/ui';
	import type { Law } from '../../law.js';
	let {
		ctx,
		field,
		law,
		subject
	}: {
		ctx: PageContext;
		field: FieldEditor;
		/** The law the record answers to; a contract's is its entity's on its first day. */
		law: Law | undefined;
		subject: 'EMPLOYEE' | 'EMPLOYER' | 'TERMS' | 'EXIT';
	} = $props();
	const stored = $derived(
		subject === 'EMPLOYER'
			? law?.settings.entity_extension_schema
			: law?.settings.employee_extension_schema
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
