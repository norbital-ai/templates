<script lang="ts">
	/**
	 * A class's `counts_toward` as the HR reader decides it: one checkbox per scheme of the
	 * version, and beside a scheme that declares parts, which part of that scheme's base the class
	 * enters (whole base, or one named part). The value stays the model's code list
	 * (`SCHEME` or `SCHEME.PART`); the checklist is only its face.
	 *
	 * A `Field` renderer: the form supplies the row (for `settings_id`), the value and the change
	 * callback, so the label, tooltip and errors stay the field's.
	 */
	import { Checkbox } from '@norbital-ai/ui/checkbox';
	import type { CollectionFormRendererProps } from '@norbital-ai/ui/collection-form';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../workspace-client.js';

	let props: CollectionFormRendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const settingsId = $derived(props.row?.settings_id == null ? '' : String(props.row.settings_id));
	const schemesQuery = $derived(
		settingsId === ''
			? null
			: client.db.statutory_contributions.findMany({
					where: { settings_id: { eq: settingsId } },
					columns: { code: true, name: true, parts: true },
					orderBy: { code: 'asc' },
					limit: 200
				})
	);
	const schemes = $derived(schemesQuery?.current ?? []);
	const selected = $derived(
		Array.isArray(props.value) ? props.value.map((code) => String(code)) : []
	);
	const disabled = $derived(props.mode !== 'edit' || props.disabled === true);
	const partsOf = (parts: unknown): string[] =>
		Array.isArray(parts) ? parts.map((part) => String(part)) : [];
	/** The membership of one scheme: '' when absent, the scheme code for the whole base, `CODE.PART` for a part. */
	const membership = (code: string): string =>
		selected.find((entry) => entry === code || entry.startsWith(`${code}.`)) ?? '';

	function set(code: string, entry: string): void {
		const rest = selected.filter((item) => item !== code && !item.startsWith(`${code}.`));
		props.onValueChange(entry === '' ? rest : [...rest, entry]);
	}
</script>

{#if props.mode === 'display'}
	<span class={props.class}>{selected.join(' · ') || t('component.counts_toward_none')}</span>
{:else if settingsId === ''}
	<p class="text-meta">{t('component.counts_toward_needs_version')}</p>
{:else if schemes.length === 0}
	<p class="text-meta">{t('component.counts_toward_no_schemes')}</p>
{:else}
	<Stack gap="xs" class={props.class}>
		{#if selected.length === 0}
			<p class="text-meta">{t('component.counts_toward_nothing')}</p>
		{/if}
		{#each schemes as scheme (scheme.code)}
			{@const parts = partsOf(scheme.parts)}
			{@const current = membership(scheme.code)}
			<label class="flex items-center gap-2 text-sm">
				<Checkbox
					checked={current !== ''}
					{disabled}
					onCheckedChange={(checked) => set(scheme.code, checked ? scheme.code : '')}
				/>
				<span class="min-w-0 flex-1 truncate"
					>{scheme.code}{scheme.name ? ` · ${scheme.name}` : ''}</span
				>
				{#if parts.length > 0 && current !== ''}
					<select
						class="h-8 rounded-md border border-input bg-background px-2 text-sm"
						value={current}
						{disabled}
						onchange={(event) => set(scheme.code, event.currentTarget.value)}
					>
						<option value={scheme.code}>{t('component.counts_toward_whole_base')}</option>
						{#each parts as part (part)}
							<option value={`${scheme.code}.${part}`}>{part}</option>
						{/each}
					</select>
				{/if}
			</label>
		{/each}
	</Stack>
{/if}
