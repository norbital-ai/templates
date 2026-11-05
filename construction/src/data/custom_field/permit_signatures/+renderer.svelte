<script lang="ts">
	/** Applicant, issuer and acceptor: each a name and a date, or null until that party signs. */
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import { Show } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import RecordEditor, { text, type Value } from '../../../lib/record-editor.svelte';
	type Signatures = NonNullable<CustomFieldView<'permit_signatures'>['value']>;
	type Role = keyof Signatures;
	let { view }: { view: CustomFieldView<'permit_signatures'> } = $props();
	const roles = ['applicant', 'issuer', 'acceptor'] as const satisfies readonly Role[];
	const current = $derived<Signatures>(
		view.value ?? { applicant: null, issuer: null, acceptor: null }
	);
	function update(role: Role, next: Value | null): void {
		if (view.mode !== 'edit') return;
		const signed = {
			...current,
			[role]: next && { name: text(next['name']), date: text(next['date']) }
		};
		view.onChange(roles.some((r) => signed[r] != null) ? signed : null);
	}
</script>

{#if view.mode === 'show'}
	<!-- shown: each party, who signed and when, or not yet -->
	<Stack as="ul" gap="xs" class="text-sm">
		{#each roles as role (role)}
			{@const signature = current[role]}
			<li>
				<span class="text-muted-foreground">{bolt.t(`component.${role}`)}</span> ·
				{#if signature}{signature.name} · <Show
						kind={{ kind: 'date' }}
						value={signature.date}
					/>{:else}<span class="text-muted-foreground">{bolt.t('component.not_signed')}</span>{/if}
			</li>
		{/each}
	</Stack>
{:else}
	<Grid gap="sm" minimum="panel">
		{#each roles as role (role)}
			<Stack gap="sm">
				<p class="text-sm font-semibold">{bolt.t(`component.${role}`)}</p>
				<RecordEditor
					value={current[role] ?? null}
					disabled={view.disabled}
					onChange={(next) => update(role, next)}
					parts={[
						{ key: 'name', label: bolt.t('component.name') },
						{ key: 'date', label: bolt.t('component.date'), type: 'date' }
					]}
				/>
			</Stack>
		{/each}
	</Grid>
{/if}
