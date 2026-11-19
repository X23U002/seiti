// ==========================================
// 実績・バッジ（スタンプの記録から決める。保存はしない）
// window.getBadges(stamps, summary) → [{ id, icon, name, text, earned, progress: { now, goal } }]
// stamps：stamp-db.js の loadStampBook() の stamps（聖地ごと。times に取った時刻すべて）
// summary：作品ごとの聖地の数（{ titles: { 作品名: { count } } }。無ければ作品のコンプリートは数えない）
// ==========================================
(function () {
    function isWork(title) {
        return Boolean(title) && title !== "その他" && title !== "作品名不明";
    }

    // 日本時間の日付（1日の区切り）と時刻
    function japanDate(ms) {
        return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    function japanHour(ms) {
        return new Date(ms + 9 * 60 * 60 * 1000).getUTCHours();
    }

    window.getBadges = function (stamps, summary) {
        stamps = Array.isArray(stamps) ? stamps : [];

        const spotCount = stamps.length;
        const works = new Set(stamps.map(function (s) { return s.anime; }).filter(isWork));

        // 1日にいくつの聖地でスタンプを取ったか（いちばん多い日）
        const spotsByDay = {};
        let earlyBird = false;
        let nightOwl = false;
        stamps.forEach(function (stamp) {
            (stamp.times || [stamp.stampedAt]).forEach(function (time) {
                if (!time) return;
                const day = japanDate(time);
                (spotsByDay[day] = spotsByDay[day] || new Set()).add(String(stamp.id));
                const hour = japanHour(time);
                if (hour >= 4 && hour < 7) earlyBird = true;
                if (hour >= 19 || hour < 4) nightOwl = true;
            });
        });
        const bestDay = Object.keys(spotsByDay).reduce(function (best, day) {
            return Math.max(best, spotsByDay[day].size);
        }, 0);

        const mostVisits = stamps.reduce(function (most, stamp) {
            return Math.max(most, stamp.count || 1);
        }, 0);

        // その作品の聖地を全部回った作品の数
        const titles = (summary && summary.titles) || {};
        const completed = Object.keys(titles).filter(function (title) {
            const total = titles[title].count;
            const got = stamps.filter(function (s) { return s.anime === title; }).length;
            return isWork(title) && total > 0 && got >= total;
        }).length;

        function badge(id, icon, name, text, now, goal) {
            return {
                id: id,
                icon: icon,
                name: name,
                text: text,
                earned: now >= goal,
                progress: { now: Math.min(now, goal), goal: goal }
            };
        }

        return [
            badge("first", "👣", "はじめの一歩", "はじめてスタンプを取る", spotCount, 1),
            badge("hunter", "🧭", "聖地ハンター", "10か所でスタンプを取る", spotCount, 10),
            badge("master", "🏯", "聖地マスター", "30か所でスタンプを取る", spotCount, 30),
            badge("day3", "🚶", "巡礼の一日", "1日で3か所を回る", bestDay, 3),
            badge("day5", "🏃", "健脚", "1日で5か所を回る", bestDay, 5),
            badge("works3", "📺", "作品めぐり", "3作品の聖地でスタンプを取る", works.size, 3),
            badge("complete1", "🎉", "コンプリート", "1作品の聖地を全部回る", completed, 1),
            badge("complete3", "👑", "コンプリートコレクター", "3作品の聖地を全部回る", completed, 3),
            badge("regular", "⛩️", "常連さん", "同じ聖地で5回スタンプを取る", mostVisits, 5),
            badge("early", "🌅", "早起き巡礼", "朝4時〜7時にスタンプを取る", earlyBird ? 1 : 0, 1),
            badge("night", "🌙", "夜の聖地", "夜7時以降にスタンプを取る", nightOwl ? 1 : 0, 1)
        ];
    };
})();
