<script lang="ts">
	/** Applicant, issuer and acceptor: each a name and a date, or null until that party signs. */
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import RecordEditor, { type Value } from '../../../lib/record-editor.svelte';

	type Signatures = { readonly [role: string]: Value | null };
	let { view }: { view: CustomFieldView<Signatures> } = $props();
	const roles = ['applicant', 'issuer', 'acceptor'] as const;
	const current = $derived<Signatures>(
		view.value ?? { applicant: null, issuer: null, acceptor: null }
	);

	function update(role: string, signature: Value | null): void {
		if (view.mode !== 'edit') return;
		const next = { ...current, [role]: signature };
		view.onChange(Object.values(next).some((entry) => entry != null) ? next : null);
	}
</script>

<Grid gap="sm" minimum="panel">
	{#each roles as role (role)}
		<Stack gap="sm">
			<p class="text-sm font-semibold">{bolt.t(`component.${role}`)}</p>
			<RecordEditor
				value={current[role] ?? null}
				disabled={view.mode === 'edit' ? view.disabled : true}
				onChange={(next) => update(role, next)}
				parts={[
					{ key: 'name', label: bolt.t('component.name') },
					{ key: 'date', label: bolt.t('component.date'), type: 'date' }
				]}
			/>
		</Stack>
	{/each}
</Grid>
