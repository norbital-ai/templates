/**
 * A fixed header over an internally scrolling body.
 *
 * The board and the calendar both pin their day/weekday row outside the scroll region and keep it
 * aligned by hand, so the two gestures that keep the pair together — following the body's offset,
 * and driving the body from wheel input over the header — are written once.
 */

/** Keep a pinned header track horizontally aligned with the body it labels. */
export function syncHeaderTrack(body: HTMLElement | null, track: HTMLElement | null): void {
	if (body == null || track == null) return;
	track.style.transform = `translateX(${-body.scrollLeft}px)`;
}

/**
 * Wheel input over the pinned header moves the body it labels.
 *
 * The event is consumed only when the body actually moved, so scroll chaining still reaches the
 * page once the body has hit the edge in that direction.
 */
export function scrollBodyByWheel(body: HTMLElement | null, event: WheelEvent): void {
	if (body == null || (event.deltaX === 0 && event.deltaY === 0)) return;
	const beforeLeft = body.scrollLeft;
	const beforeTop = body.scrollTop;
	body.scrollLeft += event.deltaX;
	body.scrollTop += event.deltaY;
	if (body.scrollLeft !== beforeLeft || body.scrollTop !== beforeTop) event.preventDefault();
}
