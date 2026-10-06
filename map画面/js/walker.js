// =========================================================
// 現在地に歩く3Dキャラクターを表示する
//
// ・GPSで現在地が更新されると、キャラクターがその場所まで歩いて移動する
// ・進む方向に体を向け、移動中だけ歩くアニメーションを再生する
// ・3D表示の時だけ表示する（2D表示では隠して、青い現在地の点を表示する）
// ・ビルの陰に隠れないよう、建物より手前に描く
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
const MODEL_HEIGHT_PX = 130;

// キャラクターのテクスチャ（画像）。walking.fbx と同じ時に書き出した画像を置く
// ※ FBXの中にテクスチャが埋め込まれている場合は、そちらを優先して使う
const TEXTURE_URL = "../models/walking_texture.png";

// テクスチャが読み込めなかった時の色
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

// 3D表示中かどうか（Script.js の 2D/3D 切り替えボタンの状態で判断する）
function is3DMode() {
    const button = document.getElementById("toggle-view-btn");
    return Boolean(button && button.classList.contains("mode3d"));
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
    let modelLoaded = false;
    let lastFrameTime = performance.now();

    const mapElement = document.getElementById("map");

    function loadModel() {
        new FBXLoader().load(
            MODEL_URL,
            function (model) {
                applyMaterial(model);
                const normalized = normalizeSize(model);

                // 歩行アニメーション（無いモデルは歩かずに位置だけ移動する）
                const clip = model.animations[0];

                if (clip) {
                    removeRootMotion(clip);
                    mixer = new THREE.AnimationMixer(model);
                    walkAction = mixer.clipAction(clip);
                    walkAction.play();
                    walkAction.paused = true;
                }

                character.add(normalized);
                modelLoaded = true;
                map.triggerRepaint();
            },
            undefined,
            function (error) {
                console.warn("3Dキャラクターの読み込みに失敗しました:", error);
            }
        );
    }

    // マテリアル（色・テクスチャ）の設定
    function applyMaterial(model) {
        let hasEmbeddedTexture = false;

        model.traverse(function (child) {
            if (child.isMesh) {
                child.frustumCulled = false;
                [].concat(child.material).forEach(function (original) {
                    if (original && original.map) {
                        hasEmbeddedTexture = true;
                    }
                });
            }
        });

        // FBXにテクスチャが埋め込まれていれば、FBXのマテリアルをそのまま使う
        // （ノーマルマップなども一緒に使われる）
        if (hasEmbeddedTexture) {
            return;
        }

        // テクスチャが無い時は単色で表示し、TEXTURE_URL の画像が読み込めたら貼り替える
        const material = new THREE.MeshLambertMaterial({
            color: MODEL_COLOR
        });

        model.traverse(function (child) {
            if (child.isMesh) {
                child.material = material;
            }
        });

        new THREE.TextureLoader().load(
            TEXTURE_URL,
            function (texture) {
                texture.colorSpace = THREE.SRGBColorSpace;
                material.map = texture;
                material.color.set(0xffffff);
                material.needsUpdate = true;
                map.triggerRepaint();
            },
            undefined,
            function () {
                console.info("テクスチャが無いため、単色で表示します:", TEXTURE_URL);
            }
        );
    }

    // モデルによって大きさの単位が違う（1 や 190cm など）ため、
    // 高さを 1 にそろえ、足元が地面（原点）に来るように位置を合わせる
    function normalizeSize(model) {
        model.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        model.position.x -= center.x;
        model.position.y -= box.min.y;
        model.position.z -= center.z;

        const wrapper = new THREE.Group();
        wrapper.scale.setScalar(1 / (size.y || 1));
        wrapper.add(model);
        return wrapper;
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
            if (!state.position || !modelLoaded) {
                return;
            }

            const now = performance.now();
            const delta = (now - lastFrameTime) / 1000;
            lastFrameTime = now;

            // 2D表示中も位置だけは更新しておく（3Dに切り替えた時に正しい場所に出す）
            const moving = updatePosition(now);

            // 2D表示ではキャラクターを隠し、青い現在地の点を表示する
            const visible = is3DMode();
            mapElement?.classList.toggle("walker-active", visible);

            if (!visible) {
                return;
            }
            // 移動中だけ歩くアニメーションを再生、止まったら立ち姿勢に戻す
            if (!walkAction) {
                // アニメーションの無いモデルは何もしない
            } else if (moving) {
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
            // 常に地面にまっすぐ立たせ、進む方向へ向ける
            character.rotation.set(0, Math.PI - state.heading, 0);

            // --- 地図の座標系へ変換して描画 ---
            const modelMatrix = new THREE.Matrix4()
                .makeTranslation(mercator.x, mercator.y, mercator.z)
                .scale(new THREE.Vector3(scale, -scale, scale))
                .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

            camera.projectionMatrix = new THREE.Matrix4()
                .fromArray(matrix)
                .multiply(modelMatrix);

            renderer.resetState();

            // 建物の奥行き情報を消してから描くことで、ビルに埋もれず常に手前に見せる
            renderer.clearDepth();
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

    // スタイルの読み込みが終わっていればすぐ追加、まだなら終わるのを待つ。
    // ※ map.isStyleLoaded() は建物などのタイルを読み込んでいる間も false を返すため、
    //   判定には使わない（使うと、もう来ない style.load を待ち続けて表示されない）
    try {
        addLayer();
    } catch (error) {
        map.once("style.load", addLayer);
    }

    // このファイルの読み込み前に取得済みの現在地があれば、そこに表示する
    // （PCなどでは現在地の通知が最初の1回しか来ないことがあるため）
    const lastPosition = geolocate._lastKnownPosition;

    if (lastPosition) {
        moveTo(
            lastPosition.coords.latitude,
            lastPosition.coords.longitude,
            lastPosition.coords.accuracy
        );
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function (position) {
                // 先に通知で位置を受け取っていたら何もしない
                if (state.position) {
                    return;
                }
                moveTo(
                    position.coords.latitude,
                    position.coords.longitude,
                    position.coords.accuracy
                );
                map.triggerRepaint();
            },
            function () {
                // 位置情報が使えない時はキャラクターを表示しない
            },
            {
                enableHighAccuracy: true,
                maximumAge: 60000
            }
        );
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
