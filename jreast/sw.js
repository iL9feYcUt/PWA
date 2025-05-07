// sw.js
const RSS_FEED_URL = 'https://cdn.feedcontrol.net/9803/17327-E5PpVrVETwnvL.xml';
const CACHE_NAME = 'rss-notifier-cache-v1';
const LAST_ITEM_GUID_KEY = 'last_rss_item_guid'; // Cache APIに保存する際のキー

// Service Workerインストール時
self.addEventListener('install', event => {
    console.log('Service Worker: インストール完了');
    // 新しいService WorkerをすぐにアクティブにするためにskipWaiting()を呼び出す
    event.waitUntil(self.skipWaiting());
});

// Service Workerアクティベート時
self.addEventListener('activate', event => {
    console.log('Service Worker: アクティベート完了');
    // このService Workerが制御するページをすぐに制御下に置く
    event.waitUntil(self.clients.claim());
});

// 定期的なバックグラウンド同期イベント (Android Chromeなどで有効)
self.addEventListener('periodicsync', event => {
    if (event.tag === 'check-rss-update') {
        console.log('Service Worker: Periodic Sync イベント受信 - RSSフィード更新チェック開始');
        event.waitUntil(checkRssAndNotify());
    }
});

// メインスレッド (app.js) からのメッセージ受信
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CHECK_RSS_NOW') {
        console.log('Service Worker: メッセージ受信 - RSSフィード更新チェック開始');
        event.waitUntil(checkRssAndNotify());
    }
});

// RSSフィードをチェックして、更新があれば通知する関数
async function checkRssAndNotify() {
    console.log('Service Worker: RSSフィードをチェック中...', RSS_FEED_URL);
    try {
        const response = await fetch(RSS_FEED_URL, { cache: 'no-store' }); // キャッシュを無効化
        if (!response.ok) {
            throw new Error(`RSSフィードの取得に失敗: ${response.status} ${response.statusText}`);
        }
        const rssText = await response.text();
        const newItems = await getNewRssItems(rssText);

        if (newItems.length > 0) {
            console.log(`Service Worker: ${newItems.length} 件の新しいアイテムが見つかりました。`);

            // 通常、RSSフィードは新しいものが先頭に来るので、最初のアイテム（最新）を通知
            const latestItem = newItems[0];
            await showNotification(latestItem.title, latestItem.description, latestItem.link, latestItem.guid);

            // 最後に通知したアイテムのGUIDを保存
            const cache = await caches.open(CACHE_NAME);
            await cache.put(new Request(LAST_ITEM_GUID_KEY), new Response(latestItem.guid));
            console.log('Service Worker: 最後に通知したアイテムのGUIDを保存:', latestItem.guid);

        } else {
            console.log('Service Worker: 新しいRSSアイテムはありませんでした。');
        }
    } catch (error) {
        console.error('Service Worker: RSSフィードの処理中にエラー:', error);
        // (任意) エラー発生を通知することも可能ですが、頻繁だとユーザー体験を損なう可能性あり
        // self.registration.showNotification('RSSチェックエラー', {
        //     body: 'RSSフィードの更新確認中にエラーが発生しました。',
        //     icon: 'icons/icon-192x192.png'
        // });
    }
}

// RSSテキストをパースして新しいアイテムを取得する関数
async function getNewRssItems(rssText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(rssText, 'application/xml');
    const items = Array.from(xmlDoc.querySelectorAll('item')); // NodeListをArrayに変換
    const newItems = [];

    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(LAST_ITEM_GUID_KEY);
    let lastNotifiedGuid = null;
    if (cachedResponse) {
        lastNotifiedGuid = await cachedResponse.text();
        console.log('Service Worker: 前回通知したアイテムのGUID:', lastNotifiedGuid);
    }

    for (const item of items) {
        const title = item.querySelector('title')?.textContent || 'タイトルなし';
        const link = item.querySelector('link')?.textContent || '';
        // description内のHTMLタグを除去し、最初の100文字に短縮
        const descriptionRaw = item.querySelector('description')?.textContent || '';
        const description = descriptionRaw.replace(/<[^>]+>/g, '').substring(0, 100) + (descriptionRaw.length > 100 ? '...' : '');
        const pubDate = item.querySelector('pubDate')?.textContent || '';
        const guid = item.querySelector('guid')?.textContent || link; // GUIDがなければlinkを代替

        // 前回通知したGUIDと同じアイテムが見つかったら、それより新しいものはないと判断してループを抜ける
        // (RSSフィードが新しいものから順に並んでいる前提)
        if (guid === lastNotifiedGuid) {
            console.log('Service Worker: 前回通知したアイテムに到達:', guid);
            break;
        }
        newItems.push({ title, link, description, pubDate, guid });
    }
    // newItemsは、前回通知以降の新しいアイテムが「フィードの登場順」で入る。
    // RSSフィードは新しいものが先頭にあることが一般的なので、この配列も新しい順になっているはず。
    // 通知は最新の1件に絞るため、このままでOK。もし古い順から通知したい場合は reverse() する。
    return newItems;
}

// 通知を表示する関数
async function showNotification(title, body, url, tag) {
    if (Notification.permission === 'granted') {
        const options = {
            body: body,
            icon: 'icons/icon-192x192.png', // PWAのアイコン
            badge: 'icons/badge.png',       // Androidの通知バー等に表示される小さなアイコン (任意)
            tag: tag || url,                // 同じタグの通知は上書きされる (同じ記事の重複通知を防ぐ)
            data: {
                url: url // 通知クリック時の遷移先URL
            },
            actions: [ // (任意) 通知にアクションボタンを追加
                { action: 'open_url', title: '記事を読む' }
            ]
        };
        try {
            await self.registration.showNotification(title, options);
            console.log('Service Worker: 通知を表示しました -', title);
        } catch (err) {
            console.error('Service Worker: 通知の表示に失敗:', err);
        }
    } else {
        console.warn('Service Worker: 通知の許可がありません。');
    }
}

// 通知がクリックされたときのイベント
self.addEventListener('notificationclick', event => {
    console.log('Service Worker: 通知がクリックされました。', event.notification);
    event.notification.close(); // まず通知を閉じる

    const urlToOpen = event.notification.data && event.notification.data.url;

    if (urlToOpen) {
        // 通知に紐づけられたURLを開く
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
                // 既に同じURLのタブが開いていれば、それをフォーカスする
                for (let i = 0; i < windowClients.length; i++) {
                    const client = windowClients[i];
                    // URLの比較は厳密に行うか、ドメイン部分のみなど状況に応じて調整
                    if (client.url === urlToOpen && 'focus' in client) {
                        return client.focus();
                    }
                }
                // 開いているタブがなければ新しいタブ/ウィンドウで開く
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
        );
    } else {
        // URLがない場合 (フォールバックとしてPWAのルートを開くなど)
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
                if (windowClients.length > 0 && 'focus' in windowClients[0]) {
                    return windowClients[0].focus();
                }
                if (clients.openWindow) {
                    return clients.openWindow(self.registration.scope); // PWAのルートスコープを開く
                }
            })
        );
    }
});
