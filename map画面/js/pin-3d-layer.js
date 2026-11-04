/**
 * Independent screen-space Three.js overlay for Mapbox GL JS.
 *
 * - Keeps Mapbox Marker instances as the source of coordinates and popups.
 * - Hides only individual spot DOM markers while 3D mode and zoom > 10 are active.
 * - Draws Pin.glb on a transparent canvas above the Mapbox map, so map buildings
 *   cannot depth-occlude or distort the model.
 * - Uses an orthographic screen-space camera: the pin keeps a stable pixel size
 *   at every map zoom while its anchor follows map.project().
 */
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const ROTATION_DURATION_MS = 1500;
const ROTATION_RADIANS = Math.PI * 4;
const DEFAULT_HEIGHT_PX = 48;
const DEFAULT_YAW_DEGREES = 20;

export function createGLBPinLayer(map, options = {}) {
    if (!map || typeof map.getContainer !== "function") {
        throw new TypeError("createGLBPinLayerには初期化済みのMapbox mapが必要です。");
    }

    const modelUrl = options.modelUrl || new URL("./models/Pin.glb", import.meta.url).href;
    const is3D = typeof options.is3D === "function" ? options.is3D : () => false;
    const targetHeightPx = Math.max(12, Number(options.targetHeightPx) || DEFAULT_HEIGHT_PX);
    const yawRadians = THREE.MathUtils.degToRad(
        Number.isFinite(Number(options.yawDegrees)) ? Number(options.yawDegrees) : DEFAULT_YAW_DEGREES
    );
    // Depth thickness exaggeration is optional. 1 = exact GLB proportions.
    const depthScale = Math.max(0.5, Number(options.depthScale) || 1.35);

    let renderer = null;
    let camera = null;
    let scene = null;
    let baseScene = null;
    let modelReady = false;
    let canvasReady = false;
    let visible = false;
    let disposed = false;
    let markerList = [];
    let resizeObserver = null;
    let lastWidth = 0;
    let lastHeight = 0;
    let lastPixelRatio = 0;
    const models = new Map();
    const container = map.getContainer();

    // Separate canvas. Pointer events pass through to Mapbox.
    const canvas = document.createElement("canvas");
    canvas.className = "mapboxgl-glb-pin-overlay";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
        zIndex: String(options.zIndex ?? 1)
    });

    // Mapbox's container is normally position:relative. Ensure the overlay is anchored to it.
    const previousContainerPosition = container.style.position;
    if (!previousContainerPosition) container.style.position = "relative";
    container.appendChild(canvas);

    function restoreMarkerStyles() {
        markerList.forEach((marker) => {
            const element = marker?.getElement?.();
            if (!element) return;
            element.style.visibility = "";
            element.style.pointerEvents = "";
        });
    }

    function applyMarkerVisibility() {
        const shouldShowModels =
            canvasReady && modelReady && !disposed && is3D() && map.getZoom() > 10;
        const changed = shouldShowModels !== visible;
        visible = shouldShowModels;

        markerList.forEach((marker) => {
            const element = marker?.getElement?.();
            if (!element) return;

            // Clusters and zoomed-out single dots have no spotId and remain untouched.
            const isIndividualSpot = Boolean(element.dataset?.spotId);
            if (!isIndividualSpot) return;

            element.style.visibility = visible ? "hidden" : "";
            element.style.pointerEvents = visible ? "none" : "";
        });

        canvas.style.visibility = visible ? "visible" : "hidden";
        if (changed) renderFrame();
    }

    function disposeModels() {
        for (const model of models.values()) {
            if (scene && model.anchor) scene.remove(model.anchor);
            model.ownedMaterials.forEach((material) => material.dispose());
            // Geometry is shared from baseScene.clone(true), so it is not disposed here.
        }
        models.clear();
    }

    function applyPerPinMaterials(modelScene, colour) {
        const meshEntries = [];
        modelScene.updateMatrixWorld(true);

        modelScene.traverse((object) => {
            if (!object.isMesh) return;
            const bounds = new THREE.Box3().setFromObject(object);
            const size = bounds.getSize(new THREE.Vector3());
            const volume = Math.max(0, size.x * size.y * size.z);
            meshEntries.push({ object, volume });
        });

        if (meshEntries.length === 0) {
            console.warn("Pin.glb内にMeshがありません。");
            return [];
        }

        // In the supplied Pin.glb, the largest mesh is the body and the smaller mesh is the white centre.
        meshEntries.sort((a, b) => b.volume - a.volume);
        const bodyObject = meshEntries[0].object;
        const ownedMaterials = [];

        meshEntries.forEach(({ object }) => {
            const isBody = object === bodyObject;
            const material = new THREE.MeshStandardMaterial({
                color: isBody ? (colour || "#0b3c5d") : "#ffffff",
                roughness: isBody ? 0.38 : 0.5,
                metalness: isBody ? 0.03 : 0,
                side: THREE.DoubleSide
            });
            object.material = material;
            object.castShadow = false;
            object.receiveShadow = false;
            ownedMaterials.push(material);
        });

        return ownedMaterials;
    }

    function createModelForMarker(marker) {
        const element = marker?.getElement?.();
        const spotId = element?.dataset?.spotId;
        if (!spotId || !baseScene) return null;

        const lngLat = marker.getLngLat?.();
        if (!lngLat || !Number.isFinite(lngLat.lng) || !Number.isFinite(lngLat.lat)) return null;

        const colour = element.dataset.pinColor || "#0b3c5d";
        const anchor = new THREE.Group();
        const facing = new THREE.Group();
        const spin = new THREE.Group();
        const scaleRoot = new THREE.Group();
        const visual = baseScene.clone(true);

        // Pin.glb uses Z as its long axis and +Z as the pointed tip.
        // Rotate it so the point faces down-screen and the +Y front faces the viewer (+Z).
        visual.rotation.x = Math.PI / 2;
        visual.updateMatrixWorld(true);

        // Calculate bounds after the axis conversion, then put the pointed tip at local y=0.
        const bounds = new THREE.Box3().setFromObject(visual);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const modelHeight = Math.max(size.y, 0.001);
        visual.position.set(-center.x, -bounds.min.y, -center.z);

        const ownedMaterials = applyPerPinMaterials(visual, colour);

        scaleRoot.scale.set(
            targetHeightPx / modelHeight,
            targetHeightPx / modelHeight,
            (targetHeightPx / modelHeight) * depthScale
        );
        scaleRoot.add(visual);
        spin.add(scaleRoot);
        facing.add(spin);
        anchor.add(facing);
        scene.add(anchor);

        return {
            marker,
            anchor,
            facing,
            spin,
            ownedMaterials,
            animationStart: null,
            spotId: String(spotId)
        };
    }

    function rebuildModels() {
        if (!scene || !baseScene || disposed) return;
        disposeModels();

        markerList.forEach((marker) => {
            const model = createModelForMarker(marker);
            if (model) models.set(model.spotId, model);
        });

        applyMarkerVisibility();
        renderFrame();
    }

    function resizeRenderer() {
        if (!renderer || !camera) return false;
        const rect = container.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

        if (width === lastWidth && height === lastHeight && pixelRatio === lastPixelRatio) {
            return false;
        }

        lastWidth = width;
        lastHeight = height;
        lastPixelRatio = pixelRatio;
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);

        // Orthographic screen-space camera: one world unit equals one CSS pixel.
        camera.left = 0;
        camera.right = width;
        camera.top = height;
        camera.bottom = 0;
        camera.near = 0.1;
        camera.far = 2000;
        camera.position.set(0, 0, 1000);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        return true;
    }

    function renderFrame() {
        if (!renderer || !camera || !scene || disposed) return;
        resizeRenderer();
        applyMarkerVisibilityWithoutRender();

        if (!visible) {
            renderer.clear(true, true, true);
            return;
        }

        const now = performance.now();
        let animating = false;
        const width = lastWidth;
        const height = lastHeight;

        models.forEach((model) => {
            const lngLat = model.marker.getLngLat();
            const point = map.project(lngLat);
            const x = point.x;
            const y = height - point.y;

            // Screen-space anchor: zoom and pitch only move the pin; they do not distort its mesh.
            model.anchor.position.set(x, y, 0);
            model.anchor.visible =
                x > -targetHeightPx && x < width + targetHeightPx &&
                y > -targetHeightPx && y < height + targetHeightPx;

            // Slight yaw reveals the model's actual side thickness while keeping its face readable.
            model.facing.rotation.y = yawRadians;

            if (model.animationStart !== null) {
                const progress = Math.min(
                    (now - model.animationStart) / ROTATION_DURATION_MS,
                    1
                );
                const eased = 1 - Math.pow(1 - progress, 3);
                model.spin.rotation.y = ROTATION_RADIANS * eased;

                if (progress >= 1) {
                    model.spin.rotation.y = 0;
                    model.animationStart = null;
                } else {
                    animating = true;
                }
            }
        });

        scene.updateMatrixWorld(true);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);

        // Mapbox render events keep the overlay in sync during map gestures.
        if (animating) map.triggerRepaint();
    }

    // Avoid recursion: visibility updates inside renderFrame must not call renderFrame again.
    function applyMarkerVisibilityWithoutRender() {
        const shouldShowModels =
            canvasReady && modelReady && !disposed && is3D() && map.getZoom() > 10;
        visible = shouldShowModels;

        markerList.forEach((marker) => {
            const element = marker?.getElement?.();
            if (!element || !element.dataset?.spotId) return;
            element.style.visibility = visible ? "hidden" : "";
            element.style.pointerEvents = visible ? "none" : "";
        });
        canvas.style.visibility = visible ? "visible" : "hidden";
    }

    function onMapRender() {
        renderFrame();
    }

    function onMapResize() {
        resizeRenderer();
        renderFrame();
    }

    renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = true;

    camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 2000);
    camera.position.set(0, 0, 1000);
    camera.lookAt(0, 0, 0);
    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(-2, -3, 5);
    scene.add(keyLight);
    canvasReady = true;
    resizeRenderer();

    map.on("render", onMapRender);
    map.on("resize", onMapResize);
    map.on("move", onMapRender);

    if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
            resizeRenderer();
            renderFrame();
        });
        resizeObserver.observe(container);
    } else {
        window.addEventListener("resize", onMapResize);
    }

    // Start loading only after the overlay renderer and scene are ready.
    const loader = new GLTFLoader();
    loader.load(
        modelUrl,
        (gltf) => {
            if (disposed) return;
            baseScene = gltf.scene;
            modelReady = true;
            rebuildModels();
            applyMarkerVisibility();
            renderFrame();
            console.info("GLBピンモデルを読み込みました:", modelUrl);
        },
        undefined,
        (error) => {
            modelReady = false;
            restoreMarkerStyles();
            canvas.style.visibility = "hidden";
            console.error("3Dピンモデルを読み込めませんでした:", modelUrl, error);
        }
    );

    function setMarkers(markers) {
        markerList = Array.isArray(markers) ? markers.slice() : [];
        if (modelReady) rebuildModels();
        else applyMarkerVisibility();
        renderFrame();
    }

    function refreshVisibility() {
        applyMarkerVisibility();
        renderFrame();
    }

    function handleClick(point) {
        if (!visible || !modelReady || !point) return false;

        let hit = null;
        let bestDistance = Infinity;
        const halfWidth = targetHeightPx * 0.42;

        markerList.forEach((marker) => {
            const element = marker?.getElement?.();
            const spotId = element?.dataset?.spotId;
            if (!spotId) return;
            const model = models.get(String(spotId));
            if (!model) return;

            const screenPoint = map.project(marker.getLngLat());
            const dx = point.x - screenPoint.x;
            const dy = point.y - screenPoint.y;
            if (Math.abs(dx) > halfWidth || dy < -targetHeightPx - 10 || dy > 10) return;

            const distance = Math.hypot(dx, dy + targetHeightPx * 0.52);
            if (distance < bestDistance) {
                bestDistance = distance;
                hit = model;
            }
        });

        if (!hit) return false;
        if (hit.animationStart === null) {
            hit.animationStart = performance.now();
            hit.spin.rotation.y = 0;
        }

        const popup = hit.marker.getPopup?.();
        if (popup && !popup.isOpen()) hit.marker.togglePopup();
        map.triggerRepaint();
        return true;
    }

    function destroy() {
        if (disposed) return;
        disposed = true;
        restoreMarkerStyles();
        map.off("render", onMapRender);
        map.off("resize", onMapResize);
        map.off("move", onMapRender);
        resizeObserver?.disconnect();
        if (!resizeObserver) window.removeEventListener("resize", onMapResize);
        disposeModels();
        renderer?.dispose();
        canvas.remove();
        if (!previousContainerPosition) container.style.position = "";
    }

    return {
        id: "spot-pins-glb-screen-overlay",
        setMarkers,
        refreshVisibility,
        handleClick,
        render: renderFrame,
        destroy,
        get ready() {
            return modelReady && canvasReady;
        },
        get visible() {
            return visible;
        }
    };
}
