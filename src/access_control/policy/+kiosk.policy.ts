import { policy } from '@norbital-ai/bolt';
import { MEMBER_LIMITS } from './grants.js';

const PROFILE_FIELDS = [
	'name',
	'email',
	'phone',
	'face_embedding',
	'face_photo',
	'face_enrollment_status',
	'face_enrolled_at',
	'face_match_count',
	'face_last_match_at'
] as const;
const CONTRACT_FIELDS = ['employee_id', 'company_id', 'employee_number', 'effective_range'] as const;
const ENTITY_FIELDS = ['name', 'settings_code'] as const;
const ROSTER_FIELDS = ['employment_id', 'work_date', 'worked_intervals'] as const;

/**
 * The attendance-kiosk device: the attendance kiosk (opening it and running inside it), punches for people, and enrolments that land PENDING for HR. The update
 * check keeps APPROVED out of kiosk reach: it may enrol NONE → APPROVED or refresh an APPROVED face, never undo one.
 */
export default policy({
	description:
		'Attendance-kiosk device access: the attendance kiosk only, time entries for people, and kiosk enrollments that always land pending HR review.',
	capabilities: { kiosks: ['attendance'] },
	grants: {
		sys_file: {
			read: {
				sys_file: {
					where: { field: { eq: 'employment_profile.face_photo' } },
					fields: ['field', 'size', 'sha256', 'created_at']
				}
			}
		},
		employment_profile: {
			read: { employment_profile: { fields: PROFILE_FIELDS } },
			create: {
				columns: {
					employment_profile: [
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
				check: function* (rows, ctx) {
					return rows.every((row) => row.face_enrollment_status === 'PENDING')
						? ctx.allow()
						: ctx.deny('A kiosk enrolment waits for HR review.', {
								field: 'face_enrollment_status'
							});
				}
			},
			update: {
				columns: {
					employment_profile: [
						'face_embedding',
						'face_photo',
						'face_enrollment_status',
						'face_consent_at',
						'face_enrolled_at',
						'face_last_match_at',
						'face_match_count'
					]
				},
				check: function* (changes, ctx) {
					return changes.every(
						({ before, set }) =>
							(before.face_enrollment_status === 'NONE' ||
								before.face_enrollment_status === 'APPROVED') &&
							(set.face_enrollment_status ?? before.face_enrollment_status) === 'APPROVED'
					)
						? ctx.allow()
						: ctx.deny('A kiosk enrols or refreshes a face; it never undoes an approval.', {
								field: 'face_enrollment_status'
							});
				}
			}
		},
		employment_contract: {
			read: {
				employment_contract: { fields: CONTRACT_FIELDS },
				'employment_contract.employee_id': { fields: PROFILE_FIELDS },
				'employment_contract.company_id': { fields: ENTITY_FIELDS }
			},
			create: {
				columns: {
					employment_contract: ['employee_id', 'company_id', 'employee_number', 'effective_range']
				}
			}
		},
		entity: {
			read: {
				entity: { fields: ENTITY_FIELDS },
				'entity.employment_contract': { fields: CONTRACT_FIELDS },
				'entity.employment_contract.employee_id': { fields: PROFILE_FIELDS },
				'entity.employment_contract.roster_entry': { fields: ROSTER_FIELDS },
				// the kiosk reads no leave
				'entity.employment_contract.leave_catalog_entry': { where: { id: { in: [] } } }
			}
		},
		jurisdiction_settings: {
			read: {
				jurisdiction_settings: {
					fields: ['code', 'name', 'sealed_at', 'voided_at', 'effective_range', 'payroll']
				}
			}
		},
		roster_entry: {
			read: { roster_entry: { fields: ROSTER_FIELDS } },
			create: { columns: { roster_entry: ['employment_id', 'work_date', 'worked_intervals'] } },
			update: { columns: { roster_entry: ['worked_intervals'] } }
		}
	},
	limits: MEMBER_LIMITS
});
