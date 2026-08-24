<script lang="ts">
	import { Input } from '@norbital-ai/ui/input';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Option, Schema } from 'effect';
	import { patchedOrNull } from '../../lib/structured-value.js';
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
		props.onValueChange(patchedOrNull(contact, patch));
	}
</script>

<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
	<label class="text-sm font-medium">
		<Stack gap="xs">
			{t('component.name')}
			<Input
				value={contact.name ?? ''}
				{disabled}
				autocomplete="name"
				oninput={(event) => update({ name: event.currentTarget.value })}
			/>
		</Stack>
	</label>
	<label class="text-sm font-medium">
		<Stack gap="xs">
			{t('component.phone')}
			<Input
				value={contact.phone ?? ''}
				{disabled}
				type="tel"
				autocomplete="tel"
				oninput={(event) => update({ phone: event.currentTarget.value })}
			/>
		</Stack>
	</label>
	<label class="text-sm font-medium">
		<Stack gap="xs">
			{t('component.relationship')}
			<Input
				value={contact.relationship ?? ''}
				{disabled}
				oninput={(event) => update({ relationship: event.currentTarget.value || null })}
			/>
		</Stack>
	</label>
</Grid>
