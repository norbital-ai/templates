/**
 * Guided enrollment capture, the way a phone enrolls a face: the flow asks for a pose, watches the
 * face's rotation every frame, and captures on its own once the pose has been held inside the
 * target window with a readable embedding. No capture button.
 *
 * This module is the machine only. It is fed one observation per analysed frame (the largest face's
 * yaw and pitch and whether it carried an embedding, or nothing when no face is in frame) and
 * answers whether that frame is the capture for the current pose. Poses are taken strictly in
 * `GUIDED_POSES` order; a frame inside a later pose's window while an earlier one is pending is
 * simply not the current pose.
 */
export const GUIDED_POSES = ['straight', 'left', 'right', 'up', 'down'] as const;
export type GuidedPose = (typeof GUIDED_POSES)[number];

/** Human's `face.rotation.angle`, in radians. */
type FaceAngle = Readonly<{ yaw: number; pitch: number }>;

type PoseObservation = Readonly<{
	angle: FaceAngle | null;
	/** The engine produced a descriptor for this face; a capture without one is worthless. */
	embedding: boolean;
}>;

type Window = Readonly<{ yaw: readonly [number, number]; pitch: readonly [number, number] }>;

const degrees = (value: number): number => (value * Math.PI) / 180;

/**
 * The sign Human gives yaw when the person turns toward their own left, and pitch when they look up.
 *
 * Derived from Human's `calculateFaceAngle`: its x axis runs from the person's right cheek (mesh 234)
 * to the left cheek (454), its y axis from forehead to chin, and mesh depth grows away from the
 * camera, so a head turned to the person's left tilts the x axis toward the camera and the
 * resulting yaw is positive, while a chin brought toward the camera makes pitch negative. Not yet
 * confirmed against a live camera; flip here, nowhere else, if a device says otherwise.
 */
const HUMAN_YAW_LEFT_SIGN = 1;
const HUMAN_PITCH_UP_SIGN = -1;

const STRAIGHT_LIMIT = degrees(9);
const TURN_MIN = degrees(14);
const TURN_MAX = degrees(45);
const TILT_MIN = degrees(11);
const TILT_MAX = degrees(40);
/** How far the other axis may drift while a pose on one axis is held. */
const CROSS_AXIS_LIMIT = degrees(16);

const signed = (sign: number, min: number, max: number): readonly [number, number] =>
	sign > 0 ? [min, max] : [-max, -min];

/** The yaw and pitch each pose must sit inside, in radians. */
const POSE_WINDOWS: Readonly<Record<GuidedPose, Window>> = {
	straight: { yaw: [-STRAIGHT_LIMIT, STRAIGHT_LIMIT], pitch: [-STRAIGHT_LIMIT, STRAIGHT_LIMIT] },
	left: {
		yaw: signed(HUMAN_YAW_LEFT_SIGN, TURN_MIN, TURN_MAX),
		pitch: [-CROSS_AXIS_LIMIT, CROSS_AXIS_LIMIT]
	},
	right: {
		yaw: signed(-HUMAN_YAW_LEFT_SIGN, TURN_MIN, TURN_MAX),
		pitch: [-CROSS_AXIS_LIMIT, CROSS_AXIS_LIMIT]
	},
	up: {
		yaw: [-CROSS_AXIS_LIMIT, CROSS_AXIS_LIMIT],
		pitch: signed(HUMAN_PITCH_UP_SIGN, TILT_MIN, TILT_MAX)
	},
	down: {
		yaw: [-CROSS_AXIS_LIMIT, CROSS_AXIS_LIMIT],
		pitch: signed(-HUMAN_PITCH_UP_SIGN, TILT_MIN, TILT_MAX)
	}
};

/** A pose must stay inside its window this long before the frame is taken: no motion blur. */
const KIOSK_POSE_HOLD_MS = 600;

const inside = (value: number, [min, max]: readonly [number, number]): boolean =>
	value >= min && value <= max;

const angleInPose = (angle: FaceAngle, pose: GuidedPose): boolean =>
	inside(angle.yaw, POSE_WINDOWS[pose].yaw) && inside(angle.pitch, POSE_WINDOWS[pose].pitch);

type GuidedCaptureState = Readonly<{
	/** Poses already captured, in order. */
	captured: readonly GuidedPose[];
	/** When the current pose first entered its window with an embedding; null while outside. */
	heldSince: number | null;
	/** Whether the last observation had a face at all. */
	facePresent: boolean;
}>;

export const initialGuidedCapture = (): GuidedCaptureState => ({
	captured: [],
	heldSince: null,
	facePresent: false
});

/** The pose the flow is asking for, or null once every pose is captured. */
export const targetPose = (state: GuidedCaptureState): GuidedPose | null =>
	GUIDED_POSES[state.captured.length] ?? null;

export const guidedCaptureComplete = (state: GuidedCaptureState): boolean =>
	state.captured.length === GUIDED_POSES.length;

/** 0 to 1: how much of the hold the current pose has satisfied. Captured poses read 1. */
export const poseProgress = (state: GuidedCaptureState, pose: GuidedPose, now: number): number => {
	if (state.captured.includes(pose)) return 1;
	if (targetPose(state) !== pose || state.heldSince === null) return 0;
	return Math.min(1, (now - state.heldSince) / KIOSK_POSE_HOLD_MS);
};

type GuidedCaptureStep = Readonly<{
	state: GuidedCaptureState;
	/** This frame is the capture for `pose`; the caller snapshots it. */
	capture: GuidedPose | null;
}>;

/**
 * One observed frame. The current pose is captured when the face has sat inside its window, with an
 * embedding, for `KIOSK_POSE_HOLD_MS`; leaving the window or losing the embedding restarts the hold.
 */
export const observePose = (
	state: GuidedCaptureState,
	observation: PoseObservation | null,
	now: number
): GuidedCaptureStep => {
	const pose = targetPose(state);
	if (pose === null) return { state, capture: null };
	const angle = observation?.angle ?? null;
	const facePresent = observation !== null;
	if (
		angle === null ||
		observation === null ||
		!observation.embedding ||
		!angleInPose(angle, pose)
	) {
		return { state: { ...state, heldSince: null, facePresent }, capture: null };
	}
	const heldSince = state.heldSince ?? now;
	if (now - heldSince < KIOSK_POSE_HOLD_MS) {
		return { state: { ...state, heldSince, facePresent }, capture: null };
	}
	return {
		state: { captured: [...state.captured, pose], heldSince: null, facePresent },
		capture: pose
	};
};
