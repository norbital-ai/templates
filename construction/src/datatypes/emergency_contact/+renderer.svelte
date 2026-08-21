<script lang="ts">
	import { Input } from '@norbital-ai/ui/input';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Option, Schema } from 'effect';
	import type { RendererProps, Value } from './$types.js';
	import { emergencyContactSchema } from './+definition.js';

	let props: RendererProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	// The form edits the record field by field, so the value under edit may be missing keys the
	// definition requires; decode against the same shape with every key optional.
	const editableContactSchema = Schema.Struct({
		name: Schema.optionalKey(Schema.String),
		phone: Schema.optionalKey(Schema.String),
		relationship: Schema.optionalKey(Schema.NullOr(Schema.String))
	});
	const decodeContact = Schema.decodeUnknownOption(editableContactSchema);
	const contact = $derived<Value>(
		Option.match(decodeContact(props.value), {
			onNone: () => ({ name: '', phone: '', relationship: null }),
			onSome: ({ name, phone, relationship }) => ({
				name: name ?? '',
				phone: phone ?? '',
				relationship: relationship ?? null
			})
		})
	);

	function update(patch: Partial<Value>): void {
		if (props.mode !== 'edit') return;
		const next = { ...contact, ...patch };
		const hasValue = Object.values(next).some((value) => value != null && value !== '');
		props.onValueChange(hasValue ? next : null);
	}
</script>

<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.name')}
		<Input
			value={contact.name ?? ''}
			{disabled}
			autocomplete="name"
			oninput={(event) => update({ name: event.currentTarget.value })}
		/>
	</label>
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.phone')}
		<Input
			value={contact.phone ?? ''}
			{disabled}
			type="tel"
			autocomplete="tel"
			oninput={(event) => update({ phone: event.currentTarget.value })}
		/>
	</label>
	<label class="grid gap-1.5 text-sm font-medium">
		{t('component.relationship')}
		<Input
			value={contact.relationship ?? ''}
			{disabled}
			oninput={(event) => update({ relationship: event.currentTarget.value || null })}
		/>
	</label>
</Grid>
