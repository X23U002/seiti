// =========================================================
// 現在地に歩く3Dキャラクターを表示する
//
// ・GPSで現在地が更新されると、キャラクターがその場所まで歩いて移動する
// ・進む方向に体を向け、移動中だけ歩くアニメーションを再生する
// ・2D表示（真上から見る）の時は、画面に向かって起き上がった姿勢で表示する
//
// Script.js から initWalker(map, geolocate) を呼び出して使う
// =========================================================

import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

// ---------------------------------------------------------
// 設定
// ---------------------------------------------------------

// 3Dモデル（Mixamoの歩行アニメーション付きFBX）
const MODEL_URL = "../models/walking.fbx";

// 画面上でのキャラクターの高さ（px）。ズームしても同じ大きさに見える
const MODEL_HEIGHT_PX = 70;

// キャラクターの色
const MODEL_COLOR = 0x2f80c0;

// これより小さい移動はGPSの揺れとみなして歩かない（m）
const MIN_MOVE_METERS = 2;

// 1回の移動アニメーションにかける時間の範囲（ms）
const MIN_MOVE_DURATION_MS = 600;
const MAX_MOVE_DURATION_MS = 2000;

// 体の向きを変える速さ（大きいほど素早く向く。8で約0.3秒）
const TURN_SPEED = 8;

const LAYER_ID = "walker-3d";

// ---------------------------------------------------------
// 位置・向きの状態
// ---------------------------------------------------------
const state = {
    // 表示中の位置
    position: null,

    // 移動アニメーション
    from: null,
    to: null,
    moveStart: 0,
    moveDuration: 0,
    lastFixTime: 0,

    // 体の向き（北=0、時計回りのラジアン）
    // 最初は南（画面のこちら側）を向いて正面を見せる
    heading: Math.PI,
    targetHeading: Math.PI
};

// 2点間の距離（m）
function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad;
    const dLng = (b.lng - a.lng) * toRad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// a から b へ向かう方位（北=0、時計回りのラジアン）
function bearingBetween(a, b) {
    const dLng = (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180);
    const dLat = b.lat - a.lat;
    return Math.atan2(dLng, dLat);
}

// 角度の差を -π〜π に収める（遠回りして回転しないように）
function angleDiff(target, current) {
    return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

// ---------------------------------------------------------
// 新しい位置を受け取る
// ---------------------------------------------------------
function moveTo(lat, lng, accuracy) {
    const next = { lat: lat, lng: lng };
    const now = performance.now();

    // 最初の1回はその場に表示するだけ
    if (!state.position) {
        state.position = next;
        state.lastFixTime = now;
        return;
    }

    // GPSの誤差が大きい時は、小さな移動を揺れとみなす
    const threshold = Math.max(
        MIN_MOVE_METERS,
        Math.min((accuracy || 0) * 0.3, 10)
    );

    if (distanceMeters(state.position, next) < threshold) {
        return;
    }

    // 前回の更新からの時間をかけて歩く（次の更新までに着くように）
    const sinceLastFix = now - state.lastFixTime;

    state.from = { ...state.position };
    state.to = next;
    state.moveStart = now;
    state.moveDuration = Math.min(
        MAX_MOVE_DURATION_MS,
        Math.max(MIN_MOVE_DURATION_MS, sinceLastFix)
    );
    state.targetHeading = bearingBetween(state.from, state.to);
    state.lastFixTime = now;
}

// 移動中なら位置を進める。移動中かどうかを返す
function updatePosition(now) {
    if (!state.to) {
        return false;
    }

    const t = Math.min(1, (now - state.moveStart) / state.moveDuration);

    state.position = {
        lat: state.from.lat + (state.to.lat - state.from.lat) * t,
        lng: state.from.lng + (state.to.lng - state.from.lng) * t
    };

    if (t >= 1) {
        state.from = null;
        state.to = null;
        return false;
    }

    return true;
}

// ---------------------------------------------------------
// Mapboxのカスタムレイヤー（three.jsで描画）
// ---------------------------------------------------------
function createWalkerLayer(map) {
    let renderer = null;
    let camera = null;
    let scene = null;
    let character = null;
    let mixer = null;
    let walkAction = null;
    let lastFrameTime = performance.now();

    // キャラクターの向き・傾きを合わせるための作業用オブジェクト
    const headingQuat = new THREE.Quaternion();
    const tiltQuat = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const screenRightAxis = new THREE.Vector3();

    function loadModel() {
        new FBXLoader().load(
            MODEL_URL,
            function (model) {
                // 灰色の既定マテリアルを、見やすい色に置き換える
                model.traverse(function (child) {
                    if (child.isMesh) {
                        child.material = new THREE.MeshLambertMaterial({
                            color: MODEL_COLOR
                        });
                        child.frustumCulled = false;
                    }
                });

                // 歩行アニメーション
                const clip = model.animations[0];

                if (clip) {
                    removeRootMotion(clip);
                    mixer = new THREE.AnimationMixer(model);
                    walkAction = mixer.clipAction(clip);
                    walkAction.play();
                    walkAction.paused = true;
                }

                character.add(model);
                document.getElementById("map")?.classList.add("walker-active");
                map.triggerRepaint();
            },
            undefined,
            function (error) {
                console.warn("3Dキャラクターの読み込みに失敗しました:", error);
            }
        );
    }

    // アニメーション自体が前に進む動き（ルートモーション）を消し、
    // その場で足踏みするようにする。位置はGPSで動かすため
    function removeRootMotion(clip) {
        clip.tracks.forEach(function (track) {
            if (!/Hips\.position$/.test(track.name)) {
                return;
            }
            const values = track.values;
            for (let i = 0; i < values.length; i += 3) {
                values[i] = values[0];
                values[i + 2] = values[2];
            }
        });
    }

    return {
        id: LAYER_ID,
        type: "custom",
        renderingMode: "3d",

        onAdd: function (mapInstance, gl) {
            camera = new THREE.Camera();
            scene = new THREE.Scene();

            // 明るさ（真上からでも横からでも見えるよう複数方向から当てる）
            scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
            const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
            keyLight.position.set(1, 2, 2);
            scene.add(keyLight);

            // 足元の影
            const shadow = new THREE.Mesh(
                new THREE.CircleGeometry(0.22, 32),
                new THREE.MeshBasicMaterial({
                    color: 0x000000,
                    transparent: true,
                    opacity: 0.25,
                    depthWrite: false
                })
            );
            shadow.rotation.x = -Math.PI / 2;
            shadow.scale.set(1, 0.6, 1);
            scene.add(shadow);

            character = new THREE.Group();
            scene.add(character);

            renderer = new THREE.WebGLRenderer({
                canvas: mapInstance.getCanvas(),
                context: gl,
                antialias: true
            });
            renderer.autoClear = false;

            loadModel();
        },

        render: function (gl, matrix) {
            if (!state.position || !mixer) {
                return;
            }

            const now = performance.now();
            const delta = (now - lastFrameTime) / 1000;
            lastFrameTime = now;

            const moving = updatePosition(now);

            // 移動中だけ歩くアニメーションを再生、止まったら立ち姿勢に戻す
            if (moving) {
                walkAction.paused = false;
                mixer.update(Math.min(delta, 0.1));
            } else if (!walkAction.paused) {
                walkAction.paused = true;
                walkAction.time = 0;
                mixer.update(0);
            }

            // 体の向きを少しずつ進行方向へ（描画の速さに関係なく同じ時間で向く）
            const turn = angleDiff(state.targetHeading, state.heading);
            state.heading += turn * (1 - Math.exp(-TURN_SPEED * Math.min(delta, 0.1)));
            const turning = Math.abs(turn) > 0.01;

            // --- 位置と大きさ ---
            const lngLat = [state.position.lng, state.position.lat];
            const mercator = mapboxgl.MercatorCoordinate.fromLngLat(lngLat, 0);

            // 画面上で MODEL_HEIGHT_PX になる大きさ（m）
            const metersPerPixel =
                40075016.686 * Math.cos(state.position.lat * Math.PI / 180) /
                (512 * Math.pow(2, map.getZoom()));
            const heightMeters = Math.max(2, MODEL_HEIGHT_PX * metersPerPixel);
            const scale = mercator.meterInMercatorCoordinateUnits() * heightMeters;

            // --- 向き ---
            // モデルは +Z が正面。地図上では +X が東、-Z が北になる
            headingQuat.setFromAxisAngle(yAxis, Math.PI - state.heading);

            // 2D表示（傾き0）の時は画面に向かって起き上がらせ、
            // 3D表示（傾き60°以上）では地面にまっすぐ立たせる
            const pitch = map.getPitch();
            const tilt = Math.max(0, Math.min(1, (60 - pitch) / 60)) * (Math.PI / 2);
            const bearing = map.getBearing() * Math.PI / 180;
            screenRightAxis.set(Math.cos(bearing), 0, Math.sin(bearing));
            tiltQuat.setFromAxisAngle(screenRightAxis, -tilt);

            character.quaternion.copy(tiltQuat).multiply(headingQuat);

            // --- 地図の座標系へ変換して描画 ---
            const modelMatrix = new THREE.Matrix4()
                .makeTranslation(mercator.x, mercator.y, mercator.z)
                .scale(new THREE.Vector3(scale, -scale, scale))
                .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

            camera.projectionMatrix = new THREE.Matrix4()
                .fromArray(matrix)
                .multiply(modelMatrix);

            renderer.resetState();
            renderer.render(scene, camera);

            // 歩いている・向きを変えている間は次のフレームも描く
            if (moving || turning) {
                map.triggerRepaint();
            }
        }
    };
}

// ---------------------------------------------------------
// 初期化
// ---------------------------------------------------------
export function initWalker(map, geolocate) {
    function addLayer() {
        if (!map.getLayer(LAYER_ID)) {
            map.addLayer(createWalkerLayer(map));
        }
    }

    if (map.isStyleLoaded()) {
        addLayer();
    } else {
        map.once("style.load", addLayer);
    }

    // 現在地が更新されたらキャラクターを動かす
    geolocate.on("geolocate", function (event) {
        moveTo(
            event.coords.latitude,
            event.coords.longitude,
            event.coords.accuracy
        );
        map.triggerRepaint();
    });

    // 動作確認用：コンソールから位置を指定して歩かせる
    // 例）moveWalkerTo(35.6812, 139.7671)
    window.moveWalkerTo = function (lat, lng) {
        moveTo(lat, lng, 0);
        map.triggerRepaint();
    };
}
