<script lang="ts">
	import type { RendererProps } from './$types.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';

	let { value }: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const label = $derived.by(() => {
		if (value?.kind === 'TIME_ENTRY') return t('component.attendance');
		if (value?.kind === 'LEAVE_REQUEST') return t('component.leave');
		return t('component.payroll_input');
	});
</script>

<span>{label}</span>
