type CertificatePolicyInput = {
	readonly eventKind: string | null;
	readonly certificateFile: unknown;
};

export const LEAVE_CERTIFICATE_MISMATCH = 'LEAVE_CERTIFICATE_MISMATCH' as const;

/** Keep the real file column consistent with the event arm that is allowed to carry evidence. */
export function certificatePolicyIssues({
	eventKind,
	certificateFile
}: CertificatePolicyInput): readonly string[] {
	const attached = certificateFile != null;
	return attached && eventKind !== 'TIME_OFF'
		? ['A certificate can only be attached to a time-off request.']
		: [];
}

export function certificatePolicyMismatchMessage(issues: readonly string[]): string {
	return `${LEAVE_CERTIFICATE_MISMATCH}: ${issues.join(' ')}`;
}
