declare module 'https://esm.sh/@thatopen/components@3.4.6?deps=three@0.185.1,@thatopen/fragments@3.4.6,web-ifc@0.0.77,camera-controls@3.1.2' {
	export const Components: import('./ifc_viewer.types.js').ViewerComponentsModule['Components'];
	export const Worlds: import('./ifc_viewer.types.js').ViewerComponentsModule['Worlds'];
	export const SimpleScene: import('./ifc_viewer.types.js').ViewerComponentsModule['SimpleScene'];
	export const SimpleRenderer: import('./ifc_viewer.types.js').ViewerComponentsModule['SimpleRenderer'];
	export const SimpleCamera: import('./ifc_viewer.types.js').ViewerComponentsModule['SimpleCamera'];
	export const Grids: import('./ifc_viewer.types.js').ViewerComponentsModule['Grids'];
	export const FragmentsManager: import('./ifc_viewer.types.js').ViewerComponentsModule['FragmentsManager'];
	export const Raycasters: import('./ifc_viewer.types.js').ViewerComponentsModule['Raycasters'];
}
declare module 'https://esm.sh/@thatopen/components-front@3.4.3?deps=@thatopen/components@3.4.6,@thatopen/fragments@3.4.6,three@0.185.1,web-ifc@0.0.77,camera-controls@3.1.2' {
	export const Highlighter: import('./ifc_viewer.types.js').ViewerFrontendModule['Highlighter'];
}
declare module 'https://esm.sh/@thatopen/fragments@3.4.6?deps=three@0.185.1,web-ifc@0.0.77' {
	export const RenderedFaces: import('./ifc_viewer.types.js').ViewerFragmentsModule['RenderedFaces'];
	export const IfcImporter: import('./ifc_viewer.types.js').ViewerFragmentsModule['IfcImporter'];
}
declare module 'https://esm.sh/three@0.185.1' {
	export const Color: import('./ifc_viewer.types.js').ViewerThreeModule['Color'];
	export const Vector3: import('./ifc_viewer.types.js').ViewerThreeModule['Vector3'];
	export const Plane: import('./ifc_viewer.types.js').ViewerThreeModule['Plane'];
	export const Matrix4: import('./ifc_viewer.types.js').ViewerThreeModule['Matrix4'];
	export const BufferAttribute: import('./ifc_viewer.types.js').ViewerThreeModule['BufferAttribute'];
	export const BufferGeometry: import('./ifc_viewer.types.js').ViewerThreeModule['BufferGeometry'];
	export const EdgesGeometry: import('./ifc_viewer.types.js').ViewerThreeModule['EdgesGeometry'];
	export const MeshStandardMaterial: import('./ifc_viewer.types.js').ViewerThreeModule['MeshStandardMaterial'];
	export const LineBasicMaterial: import('./ifc_viewer.types.js').ViewerThreeModule['LineBasicMaterial'];
	export const Group: import('./ifc_viewer.types.js').ViewerThreeModule['Group'];
	export const Mesh: import('./ifc_viewer.types.js').ViewerThreeModule['Mesh'];
	export const LineSegments: import('./ifc_viewer.types.js').ViewerThreeModule['LineSegments'];
	export const Scene: import('./ifc_viewer.types.js').ViewerThreeModule['Scene'];
	export const PerspectiveCamera: import('./ifc_viewer.types.js').ViewerThreeModule['PerspectiveCamera'];
	export const HemisphereLight: import('./ifc_viewer.types.js').ViewerThreeModule['HemisphereLight'];
	export const DirectionalLight: import('./ifc_viewer.types.js').ViewerThreeModule['DirectionalLight'];
	export const Box3: import('./ifc_viewer.types.js').ViewerThreeModule['Box3'];
	export const WebGLRenderer: import('./ifc_viewer.types.js').ViewerThreeModule['WebGLRenderer'];
	export const DoubleSide: import('./ifc_viewer.types.js').ViewerThreeModule['DoubleSide'];
}
declare module 'https://esm.sh/web-ifc@0.0.77' {
	export const IfcAPI: import('./ifc_viewer.types.js').ViewerIfcApiConstructor;
}
/** esm.sh's `process` polyfill, shared by every esm.sh module that reads `process`. */
declare module 'https://esm.sh/node/process.mjs' {
	const process: object;
	export default process;
}
