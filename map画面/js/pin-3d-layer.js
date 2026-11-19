/**
 * Independent screen-space Three.js overlay for Mapbox GL JS.
 *
 * - Keeps Mapbox Marker instances as the source of coordinates and popups.
 * - Hides only individual spot DOM markers while 3D mode is active and the map shows individual spots
 *   (not the zoomed-out clusters), so switching to clusters never flashes the 2D pins.
 * - Draws the pin model (models/Pin_1.glb) on a transparent canvas above the Mapbox map, so map buildings
 *   cannot depth-occlude or distort the model.
 * - Uses an orthographic screen-space camera: the pin keeps a stable pixel size
 *   at every map zoom while its anchor follows map.project().
 * - Pins face the viewer, except the one whose details are open: that pin keeps the heading it had when it was
 *   tapped, so it turns with the map when the map rotates (押したピンだけ、地面に向きを固定する)
 */
// three.js は map.html の importmap のもの（歩くキャラクター walker.js と同じ）を使う
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const ROTATION_DURATION_MS = 1500;
const ROTATION_RADIANS = Math.PI * 4;
const DEFAULT_HEIGHT_PX = 48;
const DEFAULT_YAW_DEGREES = 0;

// 詳細を開いているピンの強調（2D表示の .is-selected と同じ見せ方。style.css）
// ・ピンを大きくする・手前に描く・足元に広がる輪を出す・ほかのピンを薄くする
const SELECTED_SCALE = 1.45;
const DIMMED_OPACITY = 0.45;
const RING_PULSE_MS = 1600;

// 遠くのピンは出さない（3D では地平線の近くに遠くのピンが固まって見にくいため）。
// 地図の真ん中から「画面の長い辺の何倍の長さ（地図の上の距離）」までを出すか。外側の FADE_START より先は少しずつ薄くする。
// ズームを引くと、その分遠くまで出る
const VISIBLE_RADIUS_SCREENS = 1.5;
const FADE_START = 0.75;
const MIN_VISIBLE_RADIUS_METERS = 500;

// 地図の真ん中からの距離（m）。近い所だけなので、平らとみなして計算する
function distanceMeters(a, b) {
    const lat = THREE.MathUtils.degToRad((a.lat + b.lat) / 2);
    const dx = THREE.MathUtils.degToRad(b.lng - a.lng) * Math.cos(lat) * 6371008;
    const dy = THREE.MathUtils.degToRad(b.lat - a.lat) * 6371008;
    return Math.hypot(dx, dy);
}

// 1px が地図の上で何 m か（Mapbox の 512px タイル）
function metersPerPixel(lat, zoom) {
    return (40075016.686 * Math.cos(THREE.MathUtils.degToRad(lat))) / (512 * Math.pow(2, zoom));
}

export function createGLBPinLayer(map, options = {}) {
    if (!map || typeof map.getContainer !== "function") {
        throw new TypeError("createGLBPinLayerには初期化済みのMapbox mapが必要です。");
    }

    const modelUrl = options.modelUrl || new URL("../models/Pin_1.glb?v=bebf0102", import.meta.url).href;
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

    // 1か所ずつのピンが置かれているか（ズーム10以下のまとめピンの時は置かれていない）。
    // ズームの数字で決めると、引いていく途中でズーム10を下回ってから、まとめピンに描き直す（ズームが止まった時）までの間、
    // 3Dのピンが消えて2Dのピンが一瞬見えてしまう。置かれているピンで決めれば、まとめピンに切りかわる時に一緒に切りかわる
    function hasSpotMarkers() {
        return markerList.some((marker) => Boolean(marker?.getElement?.()?.dataset?.spotId));
    }

    // ピンの目印：1か所ずつのピンは聖地の ID、重なったピンをまとめたピン（Script.js）は groupKey
    function pinKey(element) {
        return element?.dataset?.spotId || element?.dataset?.groupKey || "";
    }

    function applyMarkerVisibility() {
        const shouldShowModels =
            canvasReady && modelReady && !disposed && is3D() && hasSpotMarkers();
        const changed = shouldShowModels !== visible;
        visible = shouldShowModels;

        markerList.forEach((marker) => {
            const element = marker?.getElement?.();
            if (!element) return;

            // Clusters and zoomed-out single dots have no spotId and remain untouched.
            const isIndividualSpot = Boolean(pinKey(element));
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

    // 重なったピンをまとめたピンは、作品の色で縦に塗り分ける（左から順に）。
    // 部品の左右の位置（モデルの x）で色を決める（three.js の色の計算に1行足す）
    function addStripes(material, colours, geometry) {
        geometry.computeBoundingBox();
        const minX = geometry.boundingBox.min.x;
        const maxX = geometry.boundingBox.max.x;
        const stripeColours = colours.slice(0, 4).map((colour) => new THREE.Color(colour));
        while (stripeColours.length < 4) stripeColours.push(stripeColours[stripeColours.length - 1]);

        material.onBeforeCompile = (shader) => {
            shader.uniforms.stripeColours = { value: stripeColours };
            shader.uniforms.stripeCount = { value: colours.length };
            shader.uniforms.stripeMinX = { value: minX };
            shader.uniforms.stripeMaxX = { value: maxX };
            shader.vertexShader = shader.vertexShader
                .replace("void main() {", "varying float vStripeX;\nvoid main() {\n    vStripeX = position.x;");
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    "void main() {",
                    "varying float vStripeX;\nuniform vec3 stripeColours[4];\nuniform float stripeCount;\n" +
                    "uniform float stripeMinX;\nuniform float stripeMaxX;\nvoid main() {"
                )
                .replace(
                    "vec4 diffuseColor = vec4( diffuse, opacity );",
                    "float stripeT = clamp((vStripeX - stripeMinX) / max(stripeMaxX - stripeMinX, 1e-6), 0.0, 0.9999);\n" +
                    "int stripeIndex = int(floor(stripeT * stripeCount));\n" +
                    "vec3 stripeColour = stripeColours[0];\n" +
                    "if (stripeIndex == 1) stripeColour = stripeColours[1];\n" +
                    "if (stripeIndex == 2) stripeColour = stripeColours[2];\n" +
                    "if (stripeIndex == 3) stripeColour = stripeColours[3];\n" +
                    "vec4 diffuseColor = vec4( diffuse * stripeColour, opacity );"
                );
        };
        material.customProgramCacheKey = () => "pin-stripes";
    }

    // GLB内のオブジェクト名で、本体・外枠を判別して色を割り当てる。
    // colour：作品の色。colours（2つ以上）：重なったピンをまとめた時の、塗り分ける作品の色
    function applyPerPinMaterials(modelScene, colour, colours) {
    const meshEntries = [];

    modelScene.updateMatrixWorld(true);

    modelScene.traverse((object) => {
        if (!object.isMesh) return;
        meshEntries.push(object);
    });

    if (meshEntries.length === 0) {
        console.warn("ピンのモデル内にMeshがありません。");
        return [];
    }

    // 名前の先頭で本体・外枠を判定する
    const bodyObjects = meshEntries.filter(
        (object) => object.name.startsWith("Pin_body")
    );

    const outlineObjects = meshEntries.filter(
        (object) => object.name.startsWith("Pin_outline")
    );

    const bodyColour = colour || "#0b3c5d";

    // 外枠を本体色より暗くする
    const outlineColour = new THREE.Color(bodyColour)
        .multiplyScalar(0.5);

    const ownedMaterials = [];

    if (bodyObjects.length === 0) {
        console.warn('GLB内に "Pin_body" で始まるMeshが見つかりません。');
    }

    if (outlineObjects.length === 0) {
        console.warn('GLB内に "Pin_outline" で始まるMeshが見つかりません。');
    }

    const striped = Array.isArray(colours) && colours.length > 1;

    meshEntries.forEach((object) => {
        const isBody = object.name.startsWith("Pin_body");
        const isOutline = object.name.startsWith("Pin_outline");
        const isMainPart = isBody || isOutline;

        const material = new THREE.MeshStandardMaterial({
            // 塗り分ける時は、色を shader で掛ける（本体は白×作品の色、枠は暗くする）
            color: striped && isMainPart
                ? (isOutline ? new THREE.Color(0.5, 0.5, 0.5) : "#ffffff")
                : isBody
                    ? bodyColour
                    : isOutline
                        ? outlineColour
                        : "#ffffff",

            roughness: isMainPart ? 0.38 : 0.5,
            metalness: isMainPart ? 0.03 : 0,

            side: THREE.DoubleSide,
            transparent: true
        });

        if (striped && isMainPart) addStripes(material, colours, object.geometry);

        object.material = material;
        object.castShadow = false;
        object.receiveShadow = false;

        ownedMaterials.push(material);
    });

    return ownedMaterials;
}

    function createModelForMarker(marker) {
        const element = marker?.getElement?.();
        const spotId = pinKey(element);
        // 重なりのまとめに入って隠れている1か所ずつのピンは、立体にしない（まとめたピンを立体にする）
        if (!spotId || element.dataset.overlapped || !baseScene) return null;

        const lngLat = marker.getLngLat?.();
        if (!lngLat || !Number.isFinite(lngLat.lng) || !Number.isFinite(lngLat.lat)) return null;

        const colour = element.dataset.pinColor || "#0b3c5d";
        const colours = (element.dataset.pinColors || "").split(",").filter(Boolean);
        const anchor = new THREE.Group();
        const facing = new THREE.Group();
        const spin = new THREE.Group();
        const scaleRoot = new THREE.Group();
        const visual = baseScene.clone(true);

        // The pin model uses Z as its long axis and +Z as the pointed tip.
        // Rotate it so the point faces down-screen and the +Y front faces the viewer (+Z).
        visual.rotation.x = Math.PI / 2;
        visual.updateMatrixWorld(true);

        // Calculate bounds after the axis conversion, then put the pointed tip at local y=0.
        const bounds = new THREE.Box3().setFromObject(visual);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const modelHeight = Math.max(size.y, 0.001);
        visual.position.set(-center.x, -bounds.min.y, -center.z);

        const ownedMaterials = applyPerPinMaterials(visual, colour, colours);

        scaleRoot.scale.set(
            targetHeightPx / modelHeight,
            targetHeightPx / modelHeight,
            (targetHeightPx / modelHeight) * depthScale
        );
        scaleRoot.add(visual);
        spin.add(scaleRoot);
        facing.add(spin);

        // 詳細を開いている時に、ピンの先（地面）に広がる輪（横長の楕円にして地面に置いたように見せる）
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: "#0b3c5d",
            transparent: true,
            depthTest: false
        });

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(12, 15, 40),
            ringMaterial
        );

        ring.scale.set(1, 0.4, 1);
        ring.visible = false;
        ring.renderOrder = -1;

        const emphasis = new THREE.Group();
        emphasis.add(facing);
        anchor.add(ring);
        anchor.add(emphasis);
        scene.add(anchor);

        return {
            marker,
            anchor,
            facing,
            spin,
            emphasis,
            ring,
            ownedMaterials: ownedMaterials.concat(ringMaterial),
            pinMaterials: ownedMaterials,
            scale: 1,
            fixedBearing: null,
            distanceFade: 1,
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

        // 詳細を開いているピン（Script.js が元のピンに is-selected を付ける）
        const isSelected = (model) => Boolean(model.marker.getElement()?.classList.contains("is-selected"));

        let anySelected = false;
        models.forEach((model) => {
            if (isSelected(model)) anySelected = true;
        });

        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const bearing = map.getBearing();

        // 出す範囲（地図の真ん中からの距離）
        const center = map.getCenter();
        const visibleRadius = Math.max(
            MIN_VISIBLE_RADIUS_METERS,
            metersPerPixel(center.lat, map.getZoom()) * Math.max(width, height) * VISIBLE_RADIUS_SCREENS
        );

        models.forEach((model) => {
            const lngLat = model.marker.getLngLat();
            const point = map.project(lngLat);
            const x = point.x;
            const y = height - point.y;

            // Screen-space anchor: zoom and pitch only move the pin; they do not distort its mesh.
            model.anchor.position.set(x, y, 0);
            // 遠いほど薄く、出す範囲の外は出さない（詳細を開いているピンはいつも出す）
            const fromCenter = distanceMeters(center, lngLat) / visibleRadius;
            model.distanceFade = isSelected(model)
                ? 1
                : Math.min(1, Math.max(0, (1 - fromCenter) / (1 - FADE_START)));
            model.anchor.visible =
                model.distanceFade > 0 &&
                x > -targetHeightPx && x < width + targetHeightPx &&
                y > -targetHeightPx && y < height + targetHeightPx;

            // ふだんのピンはこちらを向く。押したピン（詳細を開いている間）だけは、押した時の向きのまま地面に固定し、
            // 地図を回すと一緒に回る（押した瞬間はこちらを向いているので、急に向きが変わらない）
            const selected = isSelected(model);
            if (selected && model.fixedBearing === null) model.fixedBearing = bearing;
            if (!selected) model.fixedBearing = null;

            const turned = selected ? THREE.MathUtils.degToRad(bearing - model.fixedBearing) : 0;
            model.facing.rotation.y = yawRadians + turned;

            // 詳細を開いているピンを強調する（大きく・手前に・足元に輪）。ほかのピンは薄くする
            const targetScale = selected ? SELECTED_SCALE : 1;
            model.scale = reduceMotion
                ? targetScale
                : model.scale + (targetScale - model.scale) * 0.25;

            if (Math.abs(model.scale - targetScale) < 0.01) {
                model.scale = targetScale;
            } else {
                animating = true;
            }

            model.emphasis.scale.setScalar(model.scale);
            model.anchor.position.z = selected ? 500 : 0;

            const opacity = (anySelected && !selected ? DIMMED_OPACITY : 1) * model.distanceFade;
            model.pinMaterials.forEach((material) => {
                material.opacity = opacity;
            });

            model.ring.visible = selected;

            if (selected) {
                // 輪は広がりながら薄くなるのを繰り返す（動きを減らす設定の人には止めて出す）
                const phase = reduceMotion ? 0.3 : (now % RING_PULSE_MS) / RING_PULSE_MS;
                const ringScale = 0.6 + phase * 1.6;
                model.ring.scale.set(ringScale, ringScale * 0.4, 1);
                model.ring.material.opacity = reduceMotion ? 0.9 : 0.95 * (1 - phase);

                if (!reduceMotion) animating = true;
            }

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
            canvasReady && modelReady && !disposed && is3D() && hasSpotMarkers();

        visible = shouldShowModels;

        markerList.forEach((marker) => {
            const element = marker?.getElement?.();
            if (!element || !pinKey(element)) return;

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
            const spotId = pinKey(element);
            if (!spotId) return;

            const model = models.get(String(spotId));
            // 遠くて出していない（ほとんど見えない）ピンは押せない
            if (!model || !model.anchor.visible || model.distanceFade < 0.3) return;

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
        if (popup && !popup.isOpen()) {
            hit.marker.togglePopup();
        } else if (!popup) {
            // 重なったピンをまとめたピン：元のピン（Script.js）を押した時と同じ動き（寄る・一覧を出す）
            hit.marker.getElement()?.click();
        }

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

        if (!resizeObserver) {
            window.removeEventListener("resize", onMapResize);
        }

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