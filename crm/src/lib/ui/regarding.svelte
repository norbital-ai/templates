<script lang="ts">
	/** Edits an exclusive arc (`regarding`): which collection it names, then the record in it (a `RecordRef`). */
	import { bolt } from '$bolt';
	import type { FormState } from '@norbital-ai/ui';
	import { Combobox, Picker } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { MessageKey } from '@norbital-ai/bolt';
	import * as Predicate from '../guards.js';

	type RegardingArm = 'accounts' | 'quotes' | 'purchase_orders' | 'purchase_invoices';

	/** Each arm's collection and the message key of its name. */
	let {
		form,
		arms,
		confirmed = false
	}: {
		form: FormState;
		arms: readonly (readonly [RegardingArm, MessageKey])[];
		/** Offer only confirmed documents (a payment is recorded against nothing else). */
		confirmed?: boolean;
	} = $props();
	const stored = $derived(form.get('regarding'));
	const isRef = (v: unknown): v is { readonly collection?: unknown; readonly id?: unknown } =>
		Predicate.isObjectOrArray(v) && !Array.isArray(v);
	const ref = $derived(isRef(stored) ? stored : null);
	let chosen = $state<RegardingArm | null>(null);
	const arm = $derived(arms.find(([c]) => c === ref?.collection)?.[0] ?? chosen ?? arms[0]![0]);
	const pickerValue = $derived(Predicate.isString(ref?.id) ? ref.id : null);
	const onPick = (collection: RegardingArm) => (id: string | null) =>
		form.set('regarding', id ? { collection, id } : null);
</script>

<Stack gap="xs">
	<Combobox
		size="sm"
		options={arms.map(([collection, label]) => ({ value: collection, label: bolt.t(label) }))}
		value={arm}
		onChange={(next) => {
			chosen = next;
			form.set('regarding', null);
		}}
	/>
	{#key arm}
		{#if arm === 'accounts'}
			<Picker of="accounts" value={pickerValue} onChange={onPick('accounts')} />
		{:else if arm === 'quotes'}
			{#if confirmed}
				<Picker
					of="quotes"
					where={{ status: { eq: 'confirmed' } }}
					value={pickerValue}
					onChange={onPick('quotes')}
				/>
			{:else}
				<Picker of="quotes" value={pickerValue} onChange={onPick('quotes')} />
			{/if}
		{:else if arm === 'purchase_orders'}
			<Picker
				of="purchase_orders"
				where={{ status: { eq: 'confirmed' } }}
				value={pickerValue}
				onChange={onPick('purchase_orders')}
			/>
		{:else if arm === 'purchase_invoices'}
			<Picker
				of="purchase_invoices"
				where={{ status: { eq: 'confirmed' } }}
				value={pickerValue}
				onChange={onPick('purchase_invoices')}
			/>
		{/if}
	{/key}
</Stack>
