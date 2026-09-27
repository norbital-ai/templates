<script lang="ts">
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';
	import type { Patch } from '../../../lib/ui/renderer-input.js';

	import type { CustomFieldView } from '@norbital-ai/ui';
	import { Input } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';

	import type { ValueOf } from '@norbital-ai/bolt';
	import type f from './+definition.ts';

	type BankAccount = ValueOf<typeof f.spec.shape>;

	let { view, class: className = '' }: { view: CustomFieldView<BankAccount>; class?: string } =
		$props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const incoming = $derived<Patch<BankAccount>>(view.value ?? {});

	/**
	 * All four fields are required, so a half-typed form is not a value. The partial draft is held
	 * locally and pushed upward only once complete — clearing to `null` when emptied.
	 */
	let draft = $state<Patch<BankAccount>>({});
	const account = $derived({ ...incoming, ...draft });

	function emit(next: BankAccount | null): void {
		if (view.mode === 'edit') view.onChange(next);
	}

	function update(patch: Patch<BankAccount>): void {
		draft = { ...draft, ...patch };
		const { bank_name, bank_code, bank_account_number, bank_account_name } = {
			...incoming,
			...draft
		};
		const fields = [bank_name, bank_code, bank_account_number, bank_account_name];
		if (!fields.some((entry) => entry?.trim())) emit(null);
		else if (
			bank_name &&
			bank_code &&
			bank_account_number &&
			bank_account_name &&
			fields.every((entry) => entry === entry?.trim())
		)
			emit({ bank_name, bank_code, bank_account_number, bank_account_name });
	}
</script>

<Grid
	class="{view.mode === 'edit'
		? 'rounded-md border border-border bg-muted/20 p-3'
		: ''} {className}"
	gap="sm"
	minimum="compact"
>
	<Labelled label={t('component.bank_name')} class="text-sm font-medium">
		<Input
			value={account.bank_name ?? ''}
			{disabled}
			placeholder={t('component.bank_name')}
			oninput={(event) => update({ bank_name: event.currentTarget.value })}
		/>
	</Labelled>
	<Labelled label={t('component.bank_code')} class="text-sm font-medium">
		<Input
			value={account.bank_code ?? ''}
			{disabled}
			placeholder={t('component.swift_routing_code')}
			oninput={(event) => update({ bank_code: event.currentTarget.value })}
		/>
	</Labelled>
	<Labelled label={t('component.account_holder')} class="text-sm font-medium">
		<Input
			value={account.bank_account_name ?? ''}
			{disabled}
			autocomplete="name"
			placeholder={t('component.registered_account_name')}
			oninput={(event) => update({ bank_account_name: event.currentTarget.value })}
		/>
	</Labelled>
	<Labelled label={t('component.account_number')} class="text-sm font-medium">
		<Input
			value={account.bank_account_number ?? ''}
			{disabled}
			inputmode="numeric"
			autocomplete="off"
			placeholder={t('component.bank_account_number')}
			oninput={(event) => update({ bank_account_number: event.currentTarget.value })}
		/>
	</Labelled>
</Grid>
