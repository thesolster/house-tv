package com.thesolster.housetv;

import android.service.notification.NotificationListenerService;

/**
 * Exists only so Android will let us read what's playing (media sessions).
 * We don't read or keep notifications. Enabled once over ADB:
 *   adb shell cmd notification allow_listener com.thesolster.housetv/com.thesolster.housetv.NowPlayingListener
 */
public class NowPlayingListener extends NotificationListenerService {
}
