type AssignmentLabelSource = Readonly<{
	dispatched_at?: string | null;
	status?: string | null;
}>;

/** A compact human label for assignment relationships; never expose the UUID as the label. */
export function jobAssignmentLabel(record: AssignmentLabelSource): string {
	const when = record.dispatched_at == null ? null : String(record.dispatched_at).slice(0, 10);
	return [when, record.status].filter((part) => part != null && part !== '').join(' · ') || '—';
}
