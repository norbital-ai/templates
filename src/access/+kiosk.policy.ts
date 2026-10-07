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
		sys_file: {
			read: {
				where: { field: { eq: 'employment_profile.face_photo' } },
				fields: ['id', 'field', 'size', 'sha256', 'approval_id', 'created_at']
			}
		},
		employment_profile: {
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
					'face_last_match_at',
					'approval_id'
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
					'face_enrolled_at'
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
			}
		},
		employment_contract: {
			read: {
				fields: [
					'id',
					'employee_id',
					'company_id',
					'employee_number',
					'effective_range',
					'approval_id'
				]
			},
			create: { fields: ['employee_id', 'company_id', 'employee_number', 'effective_range'] }
		},
		entity: { read: { fields: ['id', 'name', 'settings_code'] } },
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
		roster_entry: {
			read: true,
			create: { fields: ['employment_id', 'work_date', 'worked_intervals'] },
			update: { fields: ['worked_intervals'] }
		}
	},
	limits: MEMBER_LIMITS
});
