<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RendererProps } from './$types.js';
	import { Input } from '@norbital-ai/ui/input';
	import { bankAccountDraftSchema, bankAccountSchema, type BankAccount } from './+definition.js';
	import { Grid, Stack } from '@norbital-ai/ui/layout';

	const { t } = useI18n<TenantI18nKeys>();

	let props: RendererProps & { class?: string } = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);

	const parsedIncoming = $derived(Schema.decodeUnknownResult(bankAccountDraftSchema)(props.value));
	const incoming = $derived<Partial<BankAccount>>(
		Result.isSuccess(parsedIncoming) && parsedIncoming.success ? parsedIncoming.success : {}
	);

	/**
	 * All four fields are required, so a half-typed form is not a `Value`. The partial draft is held
	 * locally and pushed upward only once it parses complete — clearing to `null` when emptied.
	 */
	let draft = $state<Partial<BankAccount>>({});
	const account = $derived({ ...incoming, ...draft });

	function emit(next: BankAccount | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function update(patch: Partial<BankAccount>): void {
		draft = { ...draft, ...patch };
		const next = { ...incoming, ...draft };
		if (!Object.values(next).some((entry) => entry?.trim())) {
			emit(null);
			return;
		}
		const complete = Schema.decodeUnknownResult(bankAccountSchema)(next);
		if (Result.isSuccess(complete)) emit(complete.success);
	}
</script>

<Grid
	class="rounded-md border border-border bg-muted/20 p-3 {props.class ?? ''}"
	gap="sm"
	minimum="compact"
>
	<label class="text-sm font-medium">
		<Stack gap="xs">
			{t('component.bank_name')}
			<Input
				value={account.bank_name ?? ''}
				{disabled}
				placeholder={t('component.bank_name')}
				oninput={(event) => update({ bank_name: event.currentTarget.value })}
			/>
		</Stack>
	</label>
	<label class="text-sm font-medium">
		<Stack gap="xs">
			{t('component.bank_code')}
			<Input
				value={account.bank_code ?? ''}
				{disabled}
				placeholder={t('component.swift_routing_code')}
				oninput={(event) => update({ bank_code: event.currentTarget.value })}
			/>
		</Stack>
	</label>
	<label class="text-sm font-medium">
		<Stack gap="xs">
			{t('component.account_holder')}
			<Input
				value={account.bank_account_name ?? ''}
				{disabled}
				autocomplete="name"
				placeholder={t('component.registered_account_name')}
				oninput={(event) => update({ bank_account_name: event.currentTarget.value })}
			/>
		</Stack>
	</label>
	<label class="text-sm font-medium">
		<Stack gap="xs">
			{t('component.account_number')}
			<Input
				value={account.bank_account_number ?? ''}
				{disabled}
				inputmode="numeric"
				autocomplete="off"
				placeholder={t('component.bank_account_number')}
				oninput={(event) => update({ bank_account_number: event.currentTarget.value })}
			/>
		</Stack>
	</label>
</Grid>
