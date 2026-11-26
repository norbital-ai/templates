/** Shared task status, priority, and activity presentation metadata. */
import { format } from '@norbital-ai/ui';

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export const STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
	todo: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
	in_progress: ['in_progress', 'blocked', 'done', 'todo', 'cancelled'],
	blocked: ['blocked', 'in_progress', 'todo', 'cancelled'],
	done: ['done', 'in_progress'],
	cancelled: ['cancelled', 'todo']
};

export const STATUS_ICON: Readonly<Record<TaskStatus, string>> = {
	todo: 'lucide:circle',
	in_progress: 'lucide:circle-dot',
	blocked: 'lucide:octagon-alert',
	done: 'lucide:circle-check-big',
	cancelled: 'lucide:circle-x'
};

export const STATUS_TONE: Readonly<Record<TaskStatus, string>> = {
	todo: 'text-muted-foreground',
	in_progress: 'text-tone-info-text',
	blocked: 'text-tone-destructive-text',
	done: 'text-tone-success-text',
	cancelled: 'text-muted-foreground'
};

export const PRIORITY_ICON: Readonly<Record<TaskPriority, string>> = {
	low: 'lucide:signal-low',
	medium: 'lucide:signal-medium',
	high: 'lucide:signal-high',
	critical: 'lucide:alert-octagon'
};

export const PRIORITY_TONE: Readonly<Record<TaskPriority, string>> = {
	low: 'text-muted-foreground',
	medium: 'text-foreground',
	high: 'text-tone-warning-text',
	critical: 'text-tone-destructive-text'
};

export function formatDateRange(
	range: { readonly from?: string | null; readonly to?: string | null } | null | undefined,
	locale: string
): string | null {
	if (!range || (!range.from && !range.to)) return null;
	const from = range.from ? format({ kind: 'date' }, range.from, { locale }) : '…';
	const to = range.to ? format({ kind: 'date' }, range.to, { locale }) : '…';
	return `${from} → ${to}`;
}
