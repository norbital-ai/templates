<script lang="ts">
	/**
	 * Some keys of one json object field as fields of their own: read or edited through the shared structured
	 * renderer, writing only the shown keys back so another section's values are kept. Clearing an optional key
	 * removes it. `kinds` are the keys' labelled kinds, in display order.
	 */
	import { bolt } from '$bolt';
	import { isMasked } from '@norbital-ai/bolt';
	import {
		StructuredData,
		useBolt,
		useForm,
		type Json,
		type Kind,
		type Value
	} from '@norbital-ai/ui';
	import { asObject } from '../records/json_object.js';

	let {
		value,
		onChange,
		kinds,
		name,
		id,
		disabled = false,
		readonly = false
	}: {
		value: Value;
		onChange?: (next: Json) => void;
		kinds: Readonly<Record<string, Kind>>;
		/** The object field's name: nested errors are keyed under it (`payroll.currency`). */
		name: string;
		id: string;
		disabled?: boolean;
		readonly?: boolean;
	} = $props();
	const t = bolt.t;
	const form = useForm();
	const uiBolt = useBolt();
	const errors = $derived(
		new Map([...(form?.errors ?? [])].map(([path, message]) => [path, uiBolt.t(message)]))
	);
	const object = $derived(asObject(value) ?? {});
	const selected = $derived(
		Object.fromEntries(Object.entries(object).filter(([key]) => Object.hasOwn(kinds, key)))
	);
	const set = (next: Value) => {
		const changed = asObject(next);
		if (changed === null) return;
		const updated = { ...object };
		for (const key of Object.keys(kinds)) {
			const held = changed[key];
			if (held === undefined || held === null || held === '') delete updated[key];
			else updated[key] = held;
		}
		onChange?.(updated);
	};
</script>

{#if isMasked(value)}
	<p class="text-meta">{t('component.error')}</p>
{:else}
	<StructuredData
		kind={{ kind: 'object', fields: kinds }}
		value={selected}
		mode={readonly ? 'view' : 'edit'}
		onChange={set}
		{name}
		{id}
		{disabled}
		{errors}
	/>
{/if}
