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

export type IFCViewerTask = {
	readonly id: string;
	readonly label: string;
	readonly expressIds: readonly number[];
};

export type IFCViewerFocus = { readonly label: string; readonly expressIds: readonly number[] };

export type IFCViewerProps = {
	t: Translator;
	src: string;
	alt?: string;
	markers?: number[];
	markerGroups?: IFCViewerMarkerGroup[];
	tasks?: readonly IFCViewerTask[];
	focus?: IFCViewerFocus | null;
	onClearFocus?: () => void;
	onCreateTask?: (element: IFCSelectedElement) => void;
	onOpenTask?: (taskId: string) => void;
	onReplaceModel?: () => void;
	excludeClasses?: readonly string[];
};

export interface ViewerVector3 {
	x: number;
	y: number;
	z: number;
	set(x: number, y: number, z: number): this;
	sub(v: ViewerVector3): this;
	length(): number;
}
export interface ViewerVector3Constructor {
	new (x?: number, y?: number, z?: number): ViewerVector3;
}
export interface ViewerMatrix4 {
	fromArray(array: readonly number[]): this;
}
export interface ViewerMatrix4Constructor {
	new (): ViewerMatrix4;
}
export interface ViewerBufferAttribute {
	readonly count: number;
}
export interface ViewerBufferAttributeConstructor {
	new (array: Float32Array | Uint32Array, itemSize: number): ViewerBufferAttribute;
}
export interface ViewerBufferGeometry {
	setAttribute(name: string, attribute: ViewerBufferAttribute): this;
	setIndex(index: ViewerBufferAttribute): this;
	applyMatrix4(matrix: ViewerMatrix4): this;
	computeVertexNormals(): void;
	dispose(): void;
}
export interface ViewerBufferGeometryConstructor {
	new (): ViewerBufferGeometry;
}
export interface ViewerEdgesGeometry {
	dispose(): void;
}
export interface ViewerEdgesGeometryConstructor {
	new (geometry: ViewerBufferGeometry, thresholdAngle?: number): ViewerEdgesGeometry;
}
export interface ViewerMaterial {
	dispose(): void;
}
export interface ViewerMeshStandardMaterialConstructor {
	new (params: {
		color: ViewerColor;
		transparent?: boolean;
		opacity?: number;
		side?: number;
		roughness?: number;
		metalness?: number;
	}): ViewerMaterial;
}
export interface ViewerLineBasicMaterialConstructor {
	new (params: { color: number; transparent?: boolean; opacity?: number }): ViewerMaterial;
}
export interface ViewerObject3D {
	readonly position: ViewerVector3;
	add(object: ViewerObject3D): this;
	remove(object: ViewerObject3D): this;
	lookAt(x: number, y: number, z: number): void;
}
export interface ViewerGroupConstructor {
	new (): ViewerObject3D;
}
export interface ViewerMeshConstructor {
	new (geometry: ViewerBufferGeometry, material: ViewerMaterial): ViewerObject3D;
}
export interface ViewerLineSegmentsConstructor {
	new (geometry: ViewerEdgesGeometry, material: ViewerMaterial): ViewerObject3D;
}
export interface ViewerScene extends ViewerObject3D {
	background: ViewerColor | null;
}
export interface ViewerSceneConstructor {
	new (): ViewerScene;
}
export interface ViewerPerspectiveCamera extends ViewerObject3D {
	near: number;
	far: number;
	updateProjectionMatrix(): void;
}
export interface ViewerPerspectiveCameraConstructor {
	new (fov?: number, aspect?: number, near?: number, far?: number): ViewerPerspectiveCamera;
}
export interface ViewerLightConstructor {
	new (skyOrColor: number, groundOrIntensity?: number, intensity?: number): ViewerObject3D;
}
export interface ViewerBox3 {
	readonly min: ViewerVector3;
	readonly max: ViewerVector3;
	isEmpty(): boolean;
	setFromObject(object: ViewerObject3D): this;
	getCenter(target: ViewerVector3): ViewerVector3;
	getSize(target: ViewerVector3): ViewerVector3;
}
export interface ViewerBox3Constructor {
	new (): ViewerBox3;
}
export interface ViewerWebGLRenderer {
	readonly domElement: HTMLCanvasElement;
	setSize(width: number, height: number, updateStyle?: boolean): void;
	setPixelRatio(ratio: number): void;
	render(scene: ViewerScene, camera: ViewerPerspectiveCamera): void;
	dispose(): void;
}
export interface ViewerWebGLRendererConstructor {
	new (params: {
		antialias?: boolean;
		preserveDrawingBuffer?: boolean;
		alpha?: boolean;
		powerPreference?: 'default' | 'high-performance' | 'low-power';
	}): ViewerWebGLRenderer;
}
export interface ViewerPlane {
	constant: number;
}
export interface ViewerPlaneConstructor {
	new (normal: ViewerVector3, constant: number): ViewerPlane;
}
export interface ViewerColor {
	setStyle(style: string): this;
	setRGB(r: number, g: number, b: number): this;
}
export interface ViewerColorConstructor {
	new (style?: string | number): ViewerColor;
}

interface ViewerSceneObject {
	readonly viewerSceneObject: unique symbol;
}
interface ViewerCameraObject {
	readonly viewerCameraObject: unique symbol;
	readonly position: ViewerVector3;
	near?: number;
	far?: number;
	updateProjectionMatrix?: () => void;
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
		dollyToCursor?: boolean;
		infinityDolly?: boolean;
		dollySpeed?: number;
		truckSpeed?: number;
		smoothTime?: number;
		draggingSmoothTime?: number;
		minDistance?: number;
		maxDistance?: number;
		mouseButtons?: { left: number; middle: number; right: number; wheel: number };
		touches?: { one: number; two: number; three: number };
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
		// repository-health:allow EFF2 -- camera-controls returns a native Promise, adapted with Effect.tryPromise by the viewer.
		setTarget?: (
			targetX: number,
			targetY: number,
			targetZ: number,
			enableTransition?: boolean
		) => Promise<void>;
		// repository-health:allow EFF2 -- camera-controls returns a native Promise, adapted with Effect.tryPromise by the viewer.
		dolly?: (distance: number, enableTransition?: boolean) => Promise<void>;
		// repository-health:allow EFF2 -- camera-controls returns a native Promise, adapted with Effect.tryPromise by the viewer.
		truck?: (x: number, y: number, enableTransition?: boolean) => Promise<void>;
		getTarget(out: ViewerVector3): ViewerVector3;
		update(delta: number): boolean;
		addEventListener?: (type: string, listener: () => void) => void;
		removeEventListener?: (type: string, listener: () => void) => void;
	};
}
export interface ViewerBox {
	readonly min: ViewerVector3;
	readonly max: ViewerVector3;
	getCenter(target: ViewerVector3): ViewerVector3;
}
interface ViewerSimpleRenderer {
	three: { localClippingEnabled: boolean; clippingPlanes: ViewerPlane[] };
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
	// repository-health:allow EFF2 -- The pinned fragments vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
	getItemsIdsWithGeometry(): Promise<number[]>;
}
export interface ViewerFragmentMaterial {
	readonly isLODMaterial?: boolean;
	polygonOffset?: boolean;
	polygonOffsetFactor?: number;
	polygonOffsetUnits?: number;
	needsUpdate?: boolean;
}
export interface ViewerFragmentsManager {
	init(worker: Worker): void;
	core: {
		// repository-health:allow EFF2 -- The pinned fragments vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
		load(
			bytes: Uint8Array,
			options: { modelId: string; camera: ViewerCameraObject }
		): Promise<ViewerFragmentsModel>;
		// repository-health:allow EFF2 -- The pinned fragments vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
		disposeModel(modelId: string): Promise<void>;
		// repository-health:allow EFF2 -- The pinned fragments vendor returns a native Promise, adapted with Effect.tryPromise by the viewer.
		update?: (force?: boolean) => Promise<void>;
		models?: {
			materials?: {
				list?: {
					onItemSet?: {
						add(listener: (data: { key: number; value: ViewerFragmentMaterial }) => void): void;
					};
				};
			};
		};
	};
	list: Map<string, ViewerFragmentsModel>;
}
interface ViewerHighlightStyle {
	color: ViewerColor;
	opacity: number;
	transparent: boolean;
	renderedFaces: number;
	depthWrite?: boolean;
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
		container: HTMLDivElement,
		parameters?: { readonly logarithmicDepthBuffer?: boolean; readonly antialias?: boolean }
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
	RenderedFaces: { ONE: number; TWO: number };
	IfcImporter: new () => ViewerIfcImporter;
}
export interface ViewerThreeModule {
	Color: ViewerColorConstructor;
	Vector3: ViewerVector3Constructor;
	Plane: ViewerPlaneConstructor;
	Matrix4: ViewerMatrix4Constructor;
	BufferAttribute: ViewerBufferAttributeConstructor;
	BufferGeometry: ViewerBufferGeometryConstructor;
	EdgesGeometry: ViewerEdgesGeometryConstructor;
	MeshStandardMaterial: ViewerMeshStandardMaterialConstructor;
	LineBasicMaterial: ViewerLineBasicMaterialConstructor;
	Group: ViewerGroupConstructor;
	Mesh: ViewerMeshConstructor;
	LineSegments: ViewerLineSegmentsConstructor;
	Scene: ViewerSceneConstructor;
	PerspectiveCamera: ViewerPerspectiveCameraConstructor;
	HemisphereLight: ViewerLightConstructor;
	DirectionalLight: ViewerLightConstructor;
	Box3: ViewerBox3Constructor;
	WebGLRenderer: ViewerWebGLRendererConstructor;
	DoubleSide: number;
}
export type ViewerLocateFileHandler = (path: string, prefix: string) => string;
export interface WebIfcColor {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly w: number;
}
export interface WebIfcPlacedGeometry {
	readonly color: WebIfcColor;
	readonly geometryExpressID: number;
	readonly flatTransformation: readonly number[];
}
export interface WebIfcVector<T> {
	size(): number;
	get(index: number): T;
}
export interface WebIfcFlatMesh {
	readonly geometries: WebIfcVector<WebIfcPlacedGeometry>;
	readonly expressID: number;
	delete?(): void;
}
export interface WebIfcGeometry {
	GetVertexData(): number;
	GetVertexDataSize(): number;
	GetIndexData(): number;
	GetIndexDataSize(): number;
	delete(): void;
}
export interface ViewerIfcApi {
	Init(
		customLocateFileHandler?: ViewerLocateFileHandler,
		forceSingleThread?: boolean
		// repository-health:allow EFF2 -- web-ifc requires its patched initialization hook to preserve the vendor's native Promise contract.
	): Promise<void>;
	OpenModel(
		data: Uint8Array,
		settings?: { COORDINATE_TO_ORIGIN?: boolean; USE_FAST_BOOLS?: boolean }
	): number;
	CloseModel(modelID: number): void;
	GetFlatMesh(modelID: number, expressID: number): WebIfcFlatMesh;
	GetGeometry(modelID: number, geometryExpressID: number): WebIfcGeometry;
	GetVertexArray(ptr: number, size: number): Float32Array;
	GetIndexArray(ptr: number, size: number): Uint32Array;
}
export interface ViewerIfcApiConstructor {
	new (): ViewerIfcApi;
	prototype: ViewerIfcApi;
}
export interface ViewerIfcImporter {
	wasm: { path: string; absolute: boolean };
	classes?: { elements?: { delete(code: number): boolean } };
	// repository-health:allow EFF2 -- The pinned fragments importer returns a native Promise, adapted with Effect.tryPromise by the viewer.
	process(input: { bytes: Uint8Array }): Promise<Uint8Array>;
}

export const ConvertRequestMessageSchema = Schema.Struct({
	type: Schema.Literal('convert'),
	bytes: Schema.instanceOf(ArrayBuffer),
	excludeClasses: Schema.optionalKey(Schema.Array(Schema.String))
});
const workerSuccessMessageSchema = Schema.Struct({
	type: Schema.Literal('success'),
	fragmentBytes: Schema.instanceOf(ArrayBuffer)
});
const workerErrorMessageSchema = Schema.Struct({
	type: Schema.Literal('error'),
	error: Schema.String
});
const workerReadyMessageSchema = Schema.Struct({ type: Schema.Literal('ready') });
export const WorkerResponseMessageSchema = Schema.Union([
	workerReadyMessageSchema,
	workerSuccessMessageSchema,
	workerErrorMessageSchema
]);
export type ConvertRequestMessage = typeof ConvertRequestMessageSchema.Type;
export type WorkerSuccessMessage = typeof workerSuccessMessageSchema.Type;
export type WorkerErrorMessage = typeof workerErrorMessageSchema.Type;
export type WorkerReadyMessage = typeof workerReadyMessageSchema.Type;

/** Rewrites relative imports against `scriptUrl` so module workers run cleanly from a Blob URL in sandboxed iframes. */
export const moduleWorkerSource = (scriptText: string, scriptUrl: URL): string =>
	scriptText.replace(
		/(\bimport\s*\(?\s*|\bfrom\s*)(["'])(\.{0,2}\/[^"']*)\2/g,
		(_, lead: string, quote: string, spec: string) =>
			`${lead}${quote}${new URL(spec, scriptUrl).href}${quote}`
	);
