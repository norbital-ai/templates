import { policy } from '@norbital-ai/bolt';
import { MEMBER_LIMITS } from './grants.js';

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
			outputs: { meta: { sys_file: { where: { field: { eq: 'employee_profile.face_photo' } } } } }
		},
		employee_profile: {
			outputs: { kiosk: true },
			update: {
				columns: {
					employee_profile: [
						'face_embedding',
						'face_photo',
						'face_enrollment_status',
						'face_consent_at',
						'face_enrolled_at'
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
		employee_contract: {
			outputs: { kiosk: true }
		},
		// the kiosk output reads no leave
		entity: { outputs: { kiosk: true } },
		jurisdiction_settings: { outputs: { kiosk: true } },
		entity_profile_version: { outputs: { kiosk: true } },
		roster_entry: {
			outputs: { kiosk: true },
			create: {
				columns: {
					roster_entry: ['employment_id', 'work_date', 'actual_worked_intervals']
				}
			},
			update: { columns: { roster_entry: ['actual_worked_intervals'] } }
		}
	},
	limits: MEMBER_LIMITS
});
