import { policy } from '@norbital-ai/bolt';
import { MEMBER_LIMITS } from './grants.js';

/**
 * The attendance-kiosk device: one app, punches for people, and enrolments that land PENDING for HR. `previous`
 * keeps APPROVED out of kiosk reach: it may enrol NONE → APPROVED or refresh an APPROVED face, never undo one.
 */
export default policy({
	description:
		'Attendance-kiosk device access: the kiosk app only, time entries for people, and kiosk enrollments that always land pending HR review.',
	capabilities: { apps: ['kiosk'] },
	grants: {
		employees: {
			read: {
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
			},
			create: {
				where: { face_enrollment_status: { eq: 'PENDING' } },
				fields: [
					'name',
					'email',
					'phone',
					'face_embedding',
					'face_photo',
					'face_enrollment_status',
					'face_consent_at',
					'face_enrolled_at',
					'employments'
				]
			},
			update: {
				previous: { face_enrollment_status: { in: ['NONE', 'APPROVED'] } },
				where: { face_enrollment_status: { eq: 'APPROVED' } },
				fields: [
					'face_embedding',
					'face_photo',
					'face_enrollment_status',
					'face_consent_at',
					'face_enrolled_at',
					'face_last_match_at',
					'face_match_count'
				]
			},
			queries: ['kiosk_match'],
			actions: ['kiosk_enroll']
		},
		employments: {
			read: { fields: ['id', 'employee_id', 'company_id', 'employee_number', 'effective_range'] },
			create: { fields: ['employee_id', 'company_id', 'employee_number', 'effective_range'] }
		},
		companies: { read: { fields: ['id', 'name', 'settings_code'] } },
		jurisdiction_settings: {
			read: {
				fields: [
					'id',
					'code',
					'name',
					'sealed_at',
					'voided_at',
					'approval_id',
					'effective_range',
					'payroll'
				]
			}
		},
		employment_terms: {
			read: { fields: ['employment_id', 'shift_pattern_id', 'effective_range'] }
		},
		shift_patterns: {
			read: { fields: ['id', 'company_id', 'code', 'name', 'pattern', 'effective_range'] }
		},
		shift_definitions: { read: { fields: ['id', 'company_id', 'code', 'name', 'variant'] } },
		work_days: {
			read: true,
			create: { fields: ['employment_id', 'work_date', 'worked_intervals'] },
			update: { fields: ['worked_intervals'] },
			actions: ['kiosk_punch']
		}
	},
	limits: MEMBER_LIMITS
});
