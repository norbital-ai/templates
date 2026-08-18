<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { payrollConfigurationSnapshotSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';
	const { t } = useI18n<TenantI18nKeys>();

	let props: RendererProps = $props();
	const parsed = $derived(
		Schema.decodeUnknownResult(payrollConfigurationSnapshotSchema)(props.value)
	);
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived(current === null ? '—' : t('component.captured_at_run_time'));
</script>

<span class="block truncate text-sm" title={summary}>{summary}</span>
