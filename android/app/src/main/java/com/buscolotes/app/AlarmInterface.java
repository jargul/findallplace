package com.buscolotes.app;

import android.content.Context;
import android.content.Intent;
import android.provider.AlarmClock;
import android.webkit.JavascriptInterface;

public class AlarmInterface {

    private final Context context;

    public AlarmInterface(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public void setAlarm(int hour, int minutes, String message) {
        Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
        intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
        intent.putExtra(AlarmClock.EXTRA_MINUTES, minutes);
        intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
        intent.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }
}
