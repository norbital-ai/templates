<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Editor, is_json_schema, type FieldEditor } from '@norbital-ai/ui';
	import type { Law } from '../../law.js';
	let {
		ctx,
		field,
		law,
		subject
	}: {
		ctx: PageContext;
		field: FieldEditor;
		/** The law the record answers to: its company's, in force on the record's date. */
		law: Law | undefined;
		subject: 'EMPLOYEE' | 'EMPLOYER';
	} = $props();
	const stored = $derived(
		subject === 'EMPLOYER'
			? law?.settings.entity_extension_schema
			: law?.settings.employee_extension_schema
	);
	const schema = $derived(
		stored !== undefined && is_json_schema(stored) ? stored : { type: 'object', properties: {} }
	);
</script>

<Editor {ctx} {...field} kind={{ kind: 'json' }} json_schema={schema} />
