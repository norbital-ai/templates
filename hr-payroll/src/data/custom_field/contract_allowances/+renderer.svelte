<script lang="ts">
	/**
	 * `employment_terms.allowances` on a form: the editor in `lib/ui/contract-allowances-editor`,
	 * fed the form's row (`view.row`) for the contract and the terms' first day.
	 */
	import ContractAllowancesEditor from '../../../lib/ui/contract-allowances-editor.svelte';
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { live } from '../../../lib/ui/live.svelte.js';
	import { readRange } from '../../../lib/payroll/run/effective.js';
	import { dateKey } from '../../../lib/iso-day.js';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ContractAllowance } from '../../../lib/datatypes/contract_allowances.js';
	import * as Predicate from 'effect/Predicate';

	let {
		view,
		class: className
	}: { view: CustomFieldView<readonly ContractAllowance[]>; class?: string } = $props();
	// The form's draft (`Json`) names the contract: its id is asserted here, where it enters.
	const employmentId = $derived(
		Predicate.isString(view.row?.employment_id) && view.row.employment_id !== ''
			? (view.row.employment_id as Id<'employments'>)
			: null
	);
	// The contract names the entity, the entity its lineage.
	const employment = live(() =>
		employmentId == null
			? null
			: bolt.get('employments', employmentId, {
					company_id: { select: { settings_code: true } }
				})
	);
	const settingsCode = $derived(employment.current?.company_id?.settings_code ?? undefined);
	const firstDay = $derived.by(() => {
		const start = dateKey(readRange(view.row?.effective_range)?.start);
		return start === '' ? undefined : start;
	});
</script>

<ContractAllowancesEditor
	value={view.value}
	mode={view.mode === 'show' ? 'display' : 'edit'}
	disabled={view.mode === 'edit' ? view.disabled : true}
	{settingsCode}
	{firstDay}
	class={className ?? ''}
	onValueChange={(next) => {
		if (view.mode === 'edit') view.onChange(next);
	}}
/>
