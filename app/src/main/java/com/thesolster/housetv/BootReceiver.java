package com.thesolster.housetv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Start the phone remote and the "Last watched" recorder when the TV boots. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        RemoteService.start(ctx);
    }
}
