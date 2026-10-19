/** One analysed enrollment frame: largest face wins, same pipeline as the scan loop. */
export type KioskSample = Readonly<{
	canvas: HTMLCanvasElement;
	dataUrl: string;
	vector: number[];
	score: number;
	box: string;
	ms: number;
}>;
