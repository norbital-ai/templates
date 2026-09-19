<script lang="ts">
	/**
	 * `employment_terms.allowances` on a form: the editor in `lib/ui/contract-allowances-editor`,
	 * fed the form's row (`FieldRendererProps.row`) for the contract and the terms' first day.
	 */
	import ContractAllowancesEditor from '../../lib/ui/contract-allowances-editor.svelte';
	import { client } from '../../lib/workspace-client.js';
	import { dateKey } from '../../lib/iso-day.js';
	import type { RendererProps } from './$types.js';

	let props: RendererProps & { row?: Record<string, unknown>; class?: string } = $props();
	const employmentId = $derived(
		props.row?.employment_id == null ? '' : String(props.row.employment_id)
	);
	// The contract names the entity, the entity its lineage.
	const employmentQuery = $derived(
		employmentId === ''
			? null
			: client.db.employments.findFirst({
					where: { id: { eq: employmentId } },
					columns: { id: true },
					with: { employment_company: { columns: { settings_code: true } } }
				})
	);
	const settingsCode = $derived(
		(
			employmentQuery?.current as
				{ employment_company?: { settings_code?: string | null } | null } | null | undefined
		)?.employment_company?.settings_code ?? undefined
	);
	const firstDay = $derived.by(() => {
		const range = props.row?.effective_range as { start?: unknown } | null | undefined;
		const start = range?.start == null ? '' : dateKey(range.start as string);
		return start === '' ? undefined : start;
	});
</script>

<ContractAllowancesEditor
	value={props.value}
	mode={props.mode}
	disabled={props.mode === 'edit' ? props.disabled : true}
	{settingsCode}
	{firstDay}
	class={props.class}
	onValueChange={(next) => {
		if (props.mode === 'edit') props.onValueChange(next);
	}}
/>
