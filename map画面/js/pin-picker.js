// ==========================================
// 地図でピンを置いて位置を決める部品（聖地登録の申請で使う）
// ・住所から位置を調べる（Mapbox の住所検索）
// ・地図をタップするとピンを置き、ピンはドラッグで動かせる
// ==========================================
const MAPBOX_TOKEN =
    "pk.eyJ1Ijoia3Vyb211IiwiYSI6ImNtcDBqcGpjNjB3Y2EycnE2a3d6cGhmbG4ifQ.lQ-HQ1PQVvgpxSvj8J_9rA";

const DEFAULT_TEXT = "住所から位置を調べるか、地図をタップしてピンを置いてください。ピンはドラッグで動かせます。";

// options：{ container: 地図を出す要素, text: 位置を表示する要素, onChange: 位置が決まった時に呼ぶ }
export function createPinPicker(options) {
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
        container: options.container,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [139.7671, 35.6812],
        zoom: 10
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    let marker = null;

    function showText(lngLat) {
        options.text.textContent = lngLat
            ? "位置：緯度 " + lngLat.lat.toFixed(6) + "／経度 " + lngLat.lng.toFixed(6) + "（ピンはドラッグで動かせます）"
            : DEFAULT_TEXT;
    }

    function setPosition(lngLat, fly) {
        if (!marker) {
            marker = new mapboxgl.Marker({ draggable: true, color: "#e53935" })
                .setLngLat(lngLat)
                .addTo(map);
            marker.on("dragend", function () {
                showText(marker.getLngLat());
                if (options.onChange) options.onChange(marker.getLngLat());
            });
        } else {
            marker.setLngLat(lngLat);
        }
        showText(marker.getLngLat());
        if (fly) map.flyTo({ center: lngLat, zoom: 16 });
        if (options.onChange) options.onChange(marker.getLngLat());
    }

    map.on("click", function (event) {
        setPosition(event.lngLat, false);
    });

    showText(null);

    return {
        setPosition: setPosition,

        // 決めた位置（まだなら null）
        getPosition: function () {
            return marker ? marker.getLngLat() : null;
        },

        // 住所から位置を調べてピンを置く。見つかれば true
        geocode: async function (address) {
            const url = "https://api.mapbox.com/geocoding/v5/mapbox.places/" + encodeURIComponent(address) +
                ".json?access_token=" + MAPBOX_TOKEN + "&language=ja&country=jp&limit=1";
            const result = await (await fetch(url)).json();
            const feature = result.features && result.features[0];
            if (!feature) return false;
            setPosition({ lng: feature.center[0], lat: feature.center[1] }, true);
            return true;
        },

        resize: function () {
            map.resize();
        }
    };
}
