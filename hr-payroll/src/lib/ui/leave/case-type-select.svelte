<script lang="ts">
	/**
	 * A benefit case's case type, or with `caseType` that type's event kind, as the employment's
	 * lineage declares them (`payroll.benefit_cases`) on the case day: what the write checks.
	 */
	import CodeSelect from '../code-select.svelte';
	import { todayKey } from '../calendar.js';
	import { caseTypes } from './case-types.svelte.js';

	let {
		employmentId,
		day,
		caseType,
		value,
		disabled = false,
		onChange
	}: {
		employmentId: string | null | undefined;
		day?: string | null | undefined;
		/** Choose this type's event kind instead of a type. */
		caseType?: string | null | undefined;
		value: string | null | undefined;
		disabled?: boolean;
		onChange: (next: string | null) => void;
	} = $props();
	const types = caseTypes(
		() => employmentId,
		() => day || todayKey()
	);
	const codes = $derived(
		caseType === undefined
			? types.current.map((row) => row.case_type)
			: (types.current.find((row) => row.case_type === caseType)?.event_kinds ?? [])
	);
</script>

<CodeSelect {codes} {value} {disabled} {onChange} />
