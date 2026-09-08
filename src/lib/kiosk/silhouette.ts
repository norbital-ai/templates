/**
 * The dashed person the camera frame asks a face to fill: a human-sized head, a neck gap, and
 * shoulders that run off the bottom edge. Pure geometry from the frame's size, so the drawing scales
 * with the video element and a test can pin the proportions.
 *
 * Everything is in frame pixels. The head ellipse spans `KIOSK_SILHOUETTE_HEAD_RATIO` of the frame's
 * height and sits horizontally centred with a little more room above than a gap below; the shoulders
 * start under the neck gap and end past the bottom edge, so the frame cuts them the way a portrait
 * would. On a frame too narrow for the shoulders, the whole figure shrinks to fit.
 */
export type FrameSize = Readonly<{ width: number; height: number }>;

/** The head's height as a share of the frame's: the human-sized guide the kiosk asks for. */
const KIOSK_SILHOUETTE_HEAD_RATIO = 0.58;
/** Head width over head height, a little narrower than round. */
const HEAD_ASPECT = 0.78;
/** Where the head's centre sits, as a share of the frame's height. */
const HEAD_CENTRE_RATIO = 0.41;
/** Empty space between the chin and the shoulder line, as a share of the frame's height. */
const NECK_GAP_RATIO = 0.045;
/** Half the neck's width, in head half-widths. */
const NECK_HALF_WIDTH = 0.52;
/** Half the shoulders' width where they leave the frame, in head half-widths. */
const SHOULDER_HALF_WIDTH = 2.1;
/** How far past the bottom edge the shoulders reach, as a share of the frame's height. */
const SHOULDER_OVERSHOOT_RATIO = 0.08;
/** The widest the figure may be, as a share of the frame's width. */
const MAX_WIDTH_SHARE = 0.92;

type SilhouetteGeometry = Readonly<{
	width: number;
	height: number;
	head: Readonly<{ cx: number; cy: number; rx: number; ry: number }>;
	/** From the chin to the shoulder line: the neck gap, nothing is drawn across it. */
	neck: Readonly<{ top: number; bottom: number }>;
	/** Two shoulder strokes, from the neck outward and down past the bottom edge. */
	shoulders: Readonly<{ path: string; top: number; bottom: number }>;
}>;

const round = (value: number): number => Math.round(value * 100) / 100;

/** The detector sees the same object-cover crop as the mirrored preview; the guide is symmetric. */
export const faceInsideSilhouette = (
	box: readonly [number, number, number, number],
	image: FrameSize,
	frame: FrameSize
): boolean => {
	const { head } = silhouetteGeometry(frame);
	const [x, y, width, height] = box;
	const halfWidth = (width * frame.width) / image.width / 2;
	const halfHeight = (height * frame.height) / image.height / 2;
	const dx = (((x + width / 2) * frame.width) / image.width - head.cx) / head.rx;
	const dy = (((y + height / 2) * frame.height) / image.height - head.cy) / head.ry;
	return (
		halfHeight >= head.ry * 0.45 &&
		halfWidth > 0 &&
		(Math.abs(dx) + halfWidth / head.rx) ** 2 + dy ** 2 <= 1 &&
		dx ** 2 + (Math.abs(dy) + halfHeight / head.ry) ** 2 <= 1
	);
};

export const silhouetteGeometry = ({ width, height }: FrameSize): SilhouetteGeometry => {
	const safeWidth = Math.max(1, width);
	const safeHeight = Math.max(1, height);
	const fullRy = (safeHeight * KIOSK_SILHOUETTE_HEAD_RATIO) / 2;
	const fullRx = fullRy * HEAD_ASPECT;
	// A frame narrower than the shoulders shrinks the figure; a wide one keeps the head ratio.
	const scale = Math.min(1, (safeWidth * MAX_WIDTH_SHARE) / 2 / (fullRx * SHOULDER_HALF_WIDTH));
	const ry = fullRy * scale;
	const rx = fullRx * scale;
	const cx = safeWidth / 2;
	const cy = safeHeight * HEAD_CENTRE_RATIO;
	const chin = cy + ry;
	const shoulderTop = chin + safeHeight * NECK_GAP_RATIO * scale;
	const shoulderBottom = safeHeight * (1 + SHOULDER_OVERSHOOT_RATIO);
	const neckHalf = rx * NECK_HALF_WIDTH;
	const shoulderHalf = rx * SHOULDER_HALF_WIDTH;
	const drop = shoulderBottom - shoulderTop;
	const side = (direction: -1 | 1): string => {
		const x0 = cx + direction * neckHalf;
		const x1 = cx + direction * shoulderHalf;
		return `M${round(x0)} ${round(shoulderTop)} C ${round(x0)} ${round(shoulderTop + drop * 0.3)}, ${round(cx + direction * shoulderHalf * 0.55)} ${round(shoulderTop + drop * 0.42)}, ${round(x1)} ${round(shoulderBottom)}`;
	};
	return {
		width: safeWidth,
		height: safeHeight,
		head: { cx: round(cx), cy: round(cy), rx: round(rx), ry: round(ry) },
		neck: { top: round(chin), bottom: round(shoulderTop) },
		shoulders: {
			path: `${side(-1)} ${side(1)}`,
			top: round(shoulderTop),
			bottom: round(shoulderBottom)
		}
	};
};
