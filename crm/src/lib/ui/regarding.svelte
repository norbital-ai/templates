<script lang="ts">
	/** Edits an exclusive arc (`regarding`): which collection it names, then the record in it (a `RecordRef`). */
	import { bolt } from '$bolt';
	import type { FormState } from '@norbital-ai/ui';
	import { Combobox, Picker } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { CollectionName, MessageKey } from '@norbital-ai/bolt';
	import * as Predicate from '../guards.js';

	/** Each arm's collection and the message key of its name. */
	let {
		form,
		arms,
		confirmed = false
	}: {
		form: FormState;
		arms: readonly (readonly [CollectionName, MessageKey])[];
		/** Offer only confirmed documents (a payment is recorded against nothing else). */
		confirmed?: boolean;
	} = $props();
	const stored = $derived(form.get('regarding'));
	const isRef = (v: unknown): v is { readonly collection?: unknown; readonly id?: unknown } =>
		Predicate.isObjectOrArray(v) && !Array.isArray(v);
	const ref = $derived(isRef(stored) ? stored : null);
	let chosen = $state<CollectionName | null>(null);
	const arm = $derived(arms.find(([c]) => c === ref?.collection)?.[0] ?? chosen ?? arms[0]![0]);
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
		<Picker
			of={arm}
			{...confirmed ? { where: { status: { eq: 'confirmed' } } as never } : {}}
			value={typeof ref?.id === 'string' ? ref.id : null}
			onChange={(id) => form.set('regarding', id ? { collection: arm, id } : null)}
		/>
	{/key}
</Stack>
