import { Schema } from 'effect';

export type IFCViewerMarkerGroup = {
	label: string;
	color: string;
	expressIds: number[];
};

export type IFCViewerProps = {
	src: string;
	alt?: string;
	markers?: number[];
	markerGroups?: IFCViewerMarkerGroup[];
};

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
}

interface ViewerSimpleRenderer {}

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
	get(world: ViewerWorld): object;
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
	// repository-health:allow EFF2 -- The pinned fragments vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
	getItemsData(ids: number[]): Promise<Array<ViewerItemData | null | undefined>>;
}

export interface ViewerFragmentsManager {
	init(worker: Worker): void;
	core: {
		load(
			bytes: Uint8Array,
			options: { modelId: string; camera: ViewerCameraObject }
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
	selection: { select: Record<string, Set<number>> };
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
	RenderedFaces: { TWO: number };
	IfcImporter: new () => ViewerIfcImporter;
}

export interface ViewerThreeModule {
	Color: ViewerColorConstructor;
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
	wasm: { path: string; absolute: boolean };
	// repository-health:allow EFF2 -- The pinned fragments importer returns a native Promise, adapted with Effect.tryPromise by the converter worker.
	process(input: { bytes: Uint8Array }): Promise<Uint8Array>;
}

/** The single owner of the main-thread ↔ converter-worker message contract. */
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
