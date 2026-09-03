import type { RemoteQuery } from '@norbital-ai/std/collection';
import { client } from '../../workspace-client.js';
import type { LeavePreview, PreviewLeaveInput } from '../../leave/preview.js';

/**
 * One-shot host preview. `$derived` rebuilds the handle when the employment, leave type, visible
 * month or selected range changes, so the picker can show remaining and chargeable days before apply.
 */
export function previewLeaveQuery(input: PreviewLeaveInput): RemoteQuery<LeavePreview> {
	return client.invoke.preview_leave(input) as RemoteQuery<LeavePreview>;
}
