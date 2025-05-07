// app.js
document.addEventListener('DOMContentLoaded', () => {
    const enableNotificationsButton = document.getElementById('enableNotificationsButton');
    const notificationStatusDiv = document.getElementById('notification-status');

    if (!('serviceWorker' in navigator)) {
        console.warn('Service Worker はこのブラウザではサポートされていません。');
        notificationStatusDiv.textContent = 'Service Worker 非対応ブラウザです。通知機能は利用できません。';
        notificationStatusDiv.className = 'status-denied';
        return;
    }

    if (!('Notification' in window)) {
        console.warn('Notification API はこのブラウザではサポートされていません。');
        notificationStatusDiv.textContent = 'Notification API 非対応ブラウザです。通知機能は利用できません。';
        notificationStatusDiv.className = 'status-denied';
        return;
    }

    // Service Workerの登録
    navigator.serviceWorker.register('./sw.js')
        .then(registration => {
            console.log('Service Worker 登録成功:', registration);

            // iOSなどPeriodic Sync未対応環境向け: PWA表示時に更新チェックを促す
            if (navigator.serviceWorker.controller) { // Service Workerがアクティブなら
                navigator.serviceWorker.controller.postMessage({ type: 'CHECK_RSS_NOW' });
            }


            // Periodic Background Sync の登録 (Android Chromeなどで有効)
            // iOS SafariはこのAPIをサポートしていません (2024年5月現在)
            if ('periodicSync' in registration) {
                registerPeriodicSync(registration);
            } else {
                console.warn('Periodic Background Sync はサポートされていません。');
                notificationStatusDiv.innerHTML += '<p>バックグラウンドでの定期的な自動更新は、お使いのブラウザでは限定的かサポートされていません。アプリを開いた際に更新がチェックされます。</p>';
            }

            // 通知許可状態の確認とボタン表示
            updateNotificationButtonAndStatus();
            if (enableNotificationsButton) {
                 enableNotificationsButton.addEventListener('click', askNotificationPermission);
            }
        })
        .catch(error => {
            console.error('Service Worker 登録失敗:', error);
            notificationStatusDiv.textContent = 'Service Workerの登録に失敗しました。通知機能は利用できません。';
            notificationStatusDiv.className = 'status-denied';
        });

    function updateNotificationButtonAndStatus() {
        if (!enableNotificationsButton || !notificationStatusDiv) return;

        const permission = Notification.permission;
        if (permission === 'granted') {
            notificationStatusDiv.textContent = '通知は許可されています。新しい情報があればお知らせします。';
            notificationStatusDiv.className = 'status-granted';
            enableNotificationsButton.style.display = 'none';
        } else if (permission === 'denied') {
            notificationStatusDiv.textContent = '通知はブロックされています。ブラウザの設定から変更してください。';
            notificationStatusDiv.className = 'status-denied';
            enableNotificationsButton.style.display = 'none';
        } else { // 'default'
            notificationStatusDiv.textContent = '新しい情報を受け取るには、通知を許可してください。';
            notificationStatusDiv.className = 'status-default';
            enableNotificationsButton.style.display = 'block';
        }
    }

    function askNotificationPermission() {
        Notification.requestPermission().then(permission => {
            console.log('通知許可の結果:', permission);
            updateNotificationButtonAndStatus();
            if (permission === 'granted') {
                // 許可されたらすぐに更新チェックを試みる
                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'CHECK_RSS_NOW' });
                }
            }
        });
    }

    async function registerPeriodicSync(registration) {
        try {
            const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
            if (status.state === 'granted') {
                // 最小間隔は約12時間 (43200000ミリ秒)。頻繁すぎるとOSに無視されるため長めに設定。
                // 実際の実行間隔はブラウザやOSに依存します。
                await registration.periodicSync.register('check-rss-update', {
                    minInterval: 12 * 60 * 60 * 1000,
                });
                console.log('Periodic Sync 登録成功: check-rss-update');
                notificationStatusDiv.innerHTML += '<p>バックグラウンドでの定期的な自動更新が試みられます（Androidなど対応環境のみ）。</p>';
            } else {
                console.warn('Periodic Background Sync の権限がありません。');
                notificationStatusDiv.innerHTML += '<p>バックグラウンドでの定期的な自動更新の権限がありません。</p>';
            }
        } catch (error) {
            console.error('Periodic Sync 登録失敗:', error);
            notificationStatusDiv.innerHTML += '<p>バックグラウンドでの定期的な自動更新の登録に失敗しました。</p>';
        }
    }

    // PWAがフォアグラウンドになったときに更新チェックを促す
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.serviceWorker.controller) {
            console.log('ページがフォアグラウンドになりました。Service WorkerにRSS更新チェックを依頼します。');
            navigator.serviceWorker.controller.postMessage({ type: 'CHECK_RSS_NOW' });
        }
    });
});
