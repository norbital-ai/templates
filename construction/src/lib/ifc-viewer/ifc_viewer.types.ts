import type { PageContext } from '@norbital-ai/bolt/page';
import { Effect, Schema } from 'effect';
import * as Predicate from 'effect/Predicate';

/** A failure's message, whatever was thrown; a wrapped cause names itself. */
export const messageOf = (value: unknown): string =>
	value instanceof Error
		? value.cause !== undefined
			? messageOf(value.cause)
			: value.message
		: Predicate.isString(value)
			? value
			: String(value);

/** `fetch` as an Effect: interruptible, and a network failure named by the step that made it. */
export const fetchEffect = (url: string, step: string): Effect.Effect<Response, Error> =>
	Effect.tryPromise({
		try: (signal) => fetch(url, { signal }),
		catch: (cause) => new Error(`${step}: ${messageOf(cause)}`)
	});

export type Translator = PageContext['t'];

export type IFCViewerMarkerGroup = {
	label: string;
	color: string;
	expressIds: number[];
};

export type IFCViewerPinCoords = {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly camera_x?: number | null | undefined;
	readonly camera_y?: number | null | undefined;
	readonly camera_z?: number | null | undefined;
};

export type IFCSelectedElement = {
	readonly expressId: number;
	readonly globalId: string | null;
	readonly title: string;
	readonly subtitle: string | null;
	readonly pin: IFCViewerPinCoords | null;
	readonly properties: readonly { readonly name: string; readonly value: string }[];
};

export type IFCViewerIssueSummary = {
	readonly id: string;
	readonly issue_number: string | null;
	readonly title: string;
	readonly severity: string;
	readonly status: string;
	readonly expressId: number;
	readonly photoUrls: readonly string[];
	readonly pin: IFCViewerPinCoords | null;
};

export type IFCViewerProps = {
	t: Translator;
	src: string;
	alt?: string;
	markers?: number[];
	markerGroups?: IFCViewerMarkerGroup[];
	issues?: readonly IFCViewerIssueSummary[];
	focusIssue?: IFCViewerIssueSummary | null;
	onTagIssue?: (element: IFCSelectedElement) => void;
	onOpenIssue?: (issueId: string) => void;
};

export interface ViewerVector3 {
	x: number;
	y: number;
	z: number;
}

export interface ViewerVector3Constructor {
	new (x?: number, y?: number, z?: number): ViewerVector3;
}

export interface ViewerPlane {
	constant: number;
}

export interface ViewerPlaneConstructor {
	new (normal: ViewerVector3, constant: number): ViewerPlane;
}

export interface ViewerColor {
	setStyle(style: string): this;
}

export interface ViewerColorConstructor {
	new (style?: string): ViewerColor;
}

interface ViewerSceneObject {
	readonly viewerSceneObject: unique symbol;
}

interface ViewerCameraObject {
	readonly viewerCameraObject: unique symbol;
	readonly position: ViewerVector3;
}

interface ViewerSimpleScene {
	setup(): void;
	three: {
		background: ViewerColor | null;
		add(object: ViewerSceneObject): void;
		remove(object: ViewerSceneObject): void;
	};
}

interface ViewerSimpleCamera {
	enabled: boolean;
	three: ViewerCameraObject;
	controls: {
		// repository-health:allow EFF2 -- camera-controls returns a native Promise, adapted with Effect.tryPromise by the viewer.
		fitToBox(box: ViewerBox, enableTransition: boolean): Promise<void>;
		// repository-health:allow EFF2 -- camera-controls returns a native Promise, adapted with Effect.tryPromise by the viewer.
		setLookAt(
			positionX: number,
			positionY: number,
			positionZ: number,
			targetX: number,
			targetY: number,
			targetZ: number,
			enableTransition?: boolean
		): Promise<void>;
		getTarget(out: ViewerVector3): ViewerVector3;
		update(delta: number): boolean;
	};
}

export interface ViewerBox {
	readonly min: ViewerVector3;
	readonly max: ViewerVector3;
	getCenter(target: ViewerVector3): ViewerVector3;
}

interface ViewerSimpleRenderer {
	three: {
		localClippingEnabled: boolean;
		clippingPlanes: ViewerPlane[];
	};
}

export interface ViewerWorld {
	scene: ViewerSimpleScene;
	camera: ViewerSimpleCamera;
	renderer: ViewerSimpleRenderer;
}

interface ViewerWorlds {
	create(): ViewerWorld;
}

interface ViewerGrids {
	create(world: ViewerWorld): void;
}

interface ViewerRaycasters {
	get(world: ViewerWorld): {
		// repository-health:allow EFF2 -- raycaster vendor returns a Promise, adapted with Effect.tryPromise by the viewer.
		castRay?: () => Promise<{ point?: ViewerVector3 } | null>;
	};
}

interface ViewerItemDataValue {
	value?: string | number;
}

export interface ViewerItemData {
	[key: string]: ViewerItemDataValue | ViewerItemDataValue[] | undefined;
}

export interface ViewerFragmentsModel {
	modelId: string;
	object: ViewerSceneObject;
	box: ViewerBox;
	// repository-health:allow EFF2 -- The pinned fragments vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
	getItemsData(ids: number[]): Promise<Array<ViewerItemData | null | undefined>>;
}

export interface ViewerFragmentsManager {
	init(worker: Worker): void;
	core: {
		load(
			bytes: Uint8Array,
			options: {
				modelId: string;
				camera: ViewerCameraObject;
			}
			// repository-health:allow EFF2 -- The pinned fragments vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
		): Promise<ViewerFragmentsModel>;
		// repository-health:allow EFF2 -- The pinned fragments vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
		disposeModel(modelId: string): Promise<void>;
	};
	list: Map<string, ViewerFragmentsModel>;
}

interface ViewerHighlightStyle {
	color: ViewerColor;
	opacity: number;
	transparent: boolean;
	renderedFaces: number;
}

export interface ViewerHighlighter {
	setup(options: {
		world: ViewerWorld;
		autoHighlightOnClick: boolean;
		selectionColor: ViewerColor;
	}): void;
	multiple: 'none';
	zoomToSelection: boolean;
	styles: Map<string, ViewerHighlightStyle>;
	selection: {
		select: Record<string, Set<number>>;
	};
	// repository-health:allow EFF2 -- The pinned highlighter vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
	clear(styleId: string): Promise<void>;
	// repository-health:allow EFF2 -- The pinned highlighter vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
	highlight(styleId: string, removePrevious: boolean, zoomToSelection: boolean): Promise<void>;
	highlightByID(
		styleId: string,
		fragmentIdMap: Record<string, Set<number>>,
		removePrevious: boolean,
		zoomToSelection: boolean
		// repository-health:allow EFF2 -- The pinned highlighter vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
	): Promise<void>;
}

interface ViewerComponentToken<T> {
	readonly componentType?: T;
}

export interface ViewerComponents {
	get<T>(token: ViewerComponentToken<T>): T;
	init(): void;
	dispose(): void;
}

export interface ViewerComponentsModule {
	Components: new () => ViewerComponents;
	Worlds: ViewerComponentToken<ViewerWorlds>;
	SimpleScene: new (components: ViewerComponents) => ViewerSimpleScene;
	SimpleRenderer: new (
		components: ViewerComponents,
		container: HTMLDivElement
	) => ViewerSimpleRenderer;
	SimpleCamera: new (components: ViewerComponents) => ViewerSimpleCamera;
	Grids: ViewerComponentToken<ViewerGrids>;
	FragmentsManager: ViewerComponentToken<ViewerFragmentsManager> & {
		// repository-health:allow EFF2 -- The pinned components vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
		getWorker(): Promise<Worker>;
	};
	Raycasters: ViewerComponentToken<ViewerRaycasters>;
}

export interface ViewerFrontendModule {
	Highlighter: ViewerComponentToken<ViewerHighlighter>;
}

export interface ViewerFragmentsModule {
	RenderedFaces: {
		TWO: number;
	};
	IfcImporter: new () => ViewerIfcImporter;
}

export interface ViewerThreeModule {
	Color: ViewerColorConstructor;
	Vector3: ViewerVector3Constructor;
	Plane: ViewerPlaneConstructor;
}

export type ViewerLocateFileHandler = (path: string, prefix: string) => string;

export interface ViewerIfcApi {
	Init(
		customLocateFileHandler?: ViewerLocateFileHandler,
		forceSingleThread?: boolean
		// repository-health:allow EFF2 -- web-ifc requires its patched initialization hook to preserve the vendor's native Promise contract.
	): Promise<void>;
}

export interface ViewerIfcApiConstructor {
	new (): ViewerIfcApi;
	prototype: ViewerIfcApi;
}

export interface ViewerIfcImporter {
	wasm: {
		path: string;
		absolute: boolean;
	};
	// repository-health:allow EFF2 -- The pinned fragments importer returns a native Promise, adapted with Effect.tryPromise by the viewer.
	process(input: { bytes: Uint8Array }): Promise<Uint8Array>;
}

export const ConvertRequestMessageSchema = Schema.Struct({
	type: Schema.Literal('convert'),
	bytes: Schema.instanceOf(ArrayBuffer)
});
const workerSuccessMessageSchema = Schema.Struct({
	type: Schema.Literal('success'),
	fragmentBytes: Schema.instanceOf(ArrayBuffer)
});
const workerErrorMessageSchema = Schema.Struct({
	type: Schema.Literal('error'),
	error: Schema.String
});
const workerReadyMessageSchema = Schema.Struct({
	type: Schema.Literal('ready')
});
export const WorkerResponseMessageSchema = Schema.Union([
	workerReadyMessageSchema,
	workerSuccessMessageSchema,
	workerErrorMessageSchema
]);
export type ConvertRequestMessage = typeof ConvertRequestMessageSchema.Type;
export type WorkerSuccessMessage = typeof workerSuccessMessageSchema.Type;
export type WorkerErrorMessage = typeof workerErrorMessageSchema.Type;
export type WorkerReadyMessage = typeof workerReadyMessageSchema.Type;
