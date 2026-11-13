import { policy } from '@norbital-ai/bolt';
import { MEMBER_LIMITS } from './grants.js';

/**
 * The attendance-kiosk device: the attendance kiosk (opening it and running inside it), punches for people, and enrolments that land PENDING for HR. The update
 * check keeps APPROVED out of kiosk reach: it may enrol NONE → APPROVED or refresh an APPROVED face, never undo one.
 */
export default policy({
	description:
		'Attendance-kiosk device access: the attendance kiosk only, time entries for people, and kiosk enrollments that always land pending HR review.',
	capabilities: { apps: ['attendance'] },
	grants: {
		sys_file: {
			outputs: { meta: { where: { field: { eq: 'employee_profile.face_photo' } } } }
		},
		employee_profile: {
			outputs: { kiosk: {} },
			update: {
				columns: {
					fields: [
						'face_embedding',
						'face_photo',
						'face_enrollment_status',
						'face_consent_at',
						'face_enrolled_at'
					]
				},
				verdict: function* (changes, ctx) {
					const undone = changes.findIndex(
						({ before, after }) =>
							(before.face_enrollment_status !== 'NONE' &&
								before.face_enrollment_status !== 'APPROVED') ||
							after.face_enrollment_status !== 'APPROVED'
					);
					return undone < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.kiosk_face_enrollment_undo', {
								row: undone,
								field: 'face_enrollment_status'
							});
				}
			}
		},
		employee_contract: {
			outputs: { kiosk: {} }
		},
		// the kiosk output reads no leave
		entity: { outputs: { kiosk: {} } },
		jurisdiction: { outputs: { kiosk: {} } },
		roster_entry: {
			outputs: { kiosk: {} },
			create: {
				columns: { fields: ['employment_id', 'work_date', 'actual_worked_intervals'] }
			},
			update: { columns: { fields: ['actual_worked_intervals'] } }
		}
	},
	limits: MEMBER_LIMITS
});
