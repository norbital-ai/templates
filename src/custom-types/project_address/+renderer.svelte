<script lang="ts">
	import { Input } from '@norbital-ai/ui/input';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Option, Schema } from 'effect';
	import type { RendererProps, Value } from './$types.js';
	import { projectAddressSchema } from './+definition.js';

	let props: RendererProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	// The form edits the record field by field, so the value under edit may be missing keys the
	// definition requires; decode against the same shape with every key optional.
	const editableAddressSchema = Schema.Struct({
		line_1: Schema.optionalKey(Schema.String),
		line_2: Schema.optionalKey(Schema.NullOr(Schema.String)),
		city: Schema.optionalKey(Schema.String),
		state: Schema.optionalKey(Schema.NullOr(Schema.String)),
		postal_code: Schema.optionalKey(Schema.String),
		country: Schema.optionalKey(Schema.String)
	});
	const decodeAddress = Schema.decodeUnknownOption(editableAddressSchema);
	const address = $derived<Value>(
		Option.match(decodeAddress(props.value), {
			onNone: () => ({
				line_1: '',
				line_2: null,
				city: '',
				state: null,
				postal_code: '',
				country: ''
			}),
			onSome: ({ line_1, line_2, city, state, postal_code, country }) => ({
				line_1: line_1 ?? '',
				line_2: line_2 ?? null,
				city: city ?? '',
				state: state ?? null,
				postal_code: postal_code ?? '',
				country: country ?? ''
			})
		})
	);

	function update(patch: Partial<Value>): void {
		if (props.mode !== 'edit') return;
		const next = { ...address, ...patch };
		const hasValue = Object.values(next).some((value) => value != null && value !== '');
		props.onValueChange(hasValue ? next : null);
	}
</script>

<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.address_line_1')}
		<Input
			value={address.line_1 ?? ''}
			{disabled}
			oninput={(event) => update({ line_1: event.currentTarget.value })}
		/>
	</label>
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.address_line_2')}
		<Input
			value={address.line_2 ?? ''}
			{disabled}
			oninput={(event) => update({ line_2: event.currentTarget.value || null })}
		/>
	</label>
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.city')}
		<Input
			value={address.city ?? ''}
			{disabled}
			oninput={(event) => update({ city: event.currentTarget.value })}
		/>
	</label>
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.state')}
		<Input
			value={address.state ?? ''}
			{disabled}
			oninput={(event) => update({ state: event.currentTarget.value || null })}
		/>
	</label>
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.postal_code')}
		<Input
			value={address.postal_code ?? ''}
			{disabled}
			oninput={(event) => update({ postal_code: event.currentTarget.value })}
		/>
	</label>
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.country')}
		<Input
			value={address.country ?? ''}
			{disabled}
			oninput={(event) => update({ country: event.currentTarget.value })}
		/>
	</label>
</Grid>
