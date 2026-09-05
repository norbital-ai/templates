import { grantOn, grantsOn, mergeGrants } from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * The attendance-kiosk device account. One app, punches and enrollments, nothing else.
 *
 * `capabilities` names the single child app, so `visibleApps` offers exactly
 * `hr_controller/kiosk` and the `bolt:kiosk` declaration renders it chromeless. The grants below
 * are the complete authority: masked reads of people and days, interval-only writes on work days,
 * face-field-only writes on people, and restricted creation of kiosk-enrolled persons — always
 * PENDING, never APPROVED. HR decisions (approve, suspend) live on `hr_controller`, which already
 * holds whole-row people writes.
 *
 * Kiosk punches carry no approval flow on purpose: the kiosk is the attendance capture, and
 * holding every punch for review would leave the day unrecorded. HR-side attendance edits keep
 * their own reviewed grants.
 */
export default {
	description:
		'Attendance-kiosk device access: the kiosk app only, time entries for people, and kiosk enrollments that always land pending HR review.',
	capabilities: { apps: ['hr_controller/kiosk'] },

	grants: mergeGrants(
		grantOn('employees', 'read', {
			fields: [
				'id',
				'name',
				'email',
				'phone',
				'face_embedding',
				'face_photo',
				'face_enrollment_status',
				'face_enrolled_at',
				'face_match_count',
				'face_last_match_at'
			]
		}),
		grantOn('employees', 'mutate.new', {
			fields: [
				'name',
				'email',
				'phone',
				'face_embedding',
				'face_photo',
				'face_enrollment_status',
				'face_consent_at',
				'face_enrolled_at'
			],
			// A kiosk-created person is an enrollment awaiting HR, never an approved identity.
			authorize: ({ record }) => record.face_enrollment_status === 'PENDING'
		}),
		grantOn('employees', 'mutate.existing', {
			fields: [
				'face_embedding',
				'face_photo',
				'face_enrollment_status',
				'face_consent_at',
				'face_enrolled_at',
				'face_last_match_at',
				'face_match_count'
			],
			// Known-person enrollment (NONE→APPROVED) and bookkeeping on approved rows only.
			// Approving a PENDING row or touching a SUSPENDED one is an HR decision.
			authorize: ({ previous, changes }) => {
				const next = changes.face_enrollment_status ?? previous.face_enrollment_status;
				if (previous.face_enrollment_status === 'NONE') return next === 'APPROVED';
				if (previous.face_enrollment_status === 'APPROVED') return next === 'APPROVED';
				return false;
			}
		}),
		grantOn('employments', 'read', {
			fields: [
				'id',
				'employee_id',
				'company_id',
				'employee_number',
				'hire_date',
				'exit_date',
				'effective_range'
			]
		}),
		grantOn('employments', 'mutate.new', {
			fields: ['employee_id', 'company_id', 'employee_number', 'hire_date', 'effective_range']
		}),
		grantOn('companies', 'read', { fields: ['id', 'name'] }),
		grantOn('employment_terms', 'read', {
			fields: ['employment_id', 'work_pattern', 'effective_range']
		}),
		grantOn('shift_definitions', 'read', { fields: ['id', 'company_id', 'code', 'variant'] }),
		grantsOn('work_days', ['read']),
		// Hook dependencies, masked to exactly what the guards read. Every attendance write runs
		// the day guards as this subject: without these reads a punch on a leave day or inside a
		// paid window dies as AccessDenied instead of the refusal that names the cause.
		grantOn('leave_requests', 'read', {
			fields: [
				'employment_id',
				'kind',
				'approval_id',
				'from_date',
				'to_date',
				'half_day_start',
				'half_day_end'
			]
		}),
		grantOn('payroll_runs', 'read', {
			fields: ['company_id', 'period', 'lifecycle', 'attendance_from', 'attendance_to']
		}),
		grantOn('payslip_work_day_inputs', 'read', { fields: ['work_day_id', 'period'] }),
		grantOn('work_days', 'mutate.new', {
			fields: ['employment_id', 'work_date', 'worked_intervals', 'break_minutes']
		}),
		grantOn('work_days', 'mutate.existing', {
			fields: ['worked_intervals', 'break_minutes']
		})
	),
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 100, key: 'subject' }
	}
} satisfies Policy;
