package uts.sdk.modules.academyRtc

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/** Owns the visible system notification while a verified live session is active. */
class AcademyRtcService : Service() {
    companion object {
        var ready = false
            private set
        private var expectedStop = false
        private const val CHANNEL = "academy_live_audio"
        private const val NOTIFICATION = 7635
        private const val STOP = "academy.live.STOP"
        fun start(context: Context, microphone: Boolean) {
            expectedStop=false
            val intent = Intent(context, AcademyRtcService::class.java).putExtra("microphone", microphone)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }
        fun finish(context: Context) { expectedStop=true;ready=false;context.stopService(Intent(context, AcademyRtcService::class.java)) }
    }
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    override fun onCreate() {
        super.onCreate()
        wakeLock=(getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK,"academy:live-audio").apply { acquire() }
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { AcademyRtc.closeAll(); stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL,"直播后台播放",NotificationManager.IMPORTANCE_LOW))
        val microphone = intent?.getBooleanExtra("microphone", false) == true
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 7635, it, pendingFlags) }
        val stop = PendingIntent.getService(this, 7636, Intent(this, AcademyRtcService::class.java).setAction(STOP), pendingFlags)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        val notification = builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("老子道学书院 · 直播")
            .setContentText(if (microphone) "连麦中，切换应用后继续语音" else "后台聆听中，点击返回直播间")
            .setOngoing(true).setContentIntent(open).addAction(android.R.drawable.ic_menu_close_clear_cancel,"退出直播",stop).build()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK or (if (microphone && Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
                startForeground(NOTIFICATION, notification, types)
            } else startForeground(NOTIFICATION, notification)
            ready=true
        } catch (_: Exception) { AcademyRtc.closeAll(); stopSelf() }
        return START_NOT_STICKY
    }
    override fun onTaskRemoved(rootIntent: Intent?) { AcademyRtc.closeAll(); stopSelf(); super.onTaskRemoved(rootIntent) }
    override fun onDestroy() { ready=false;wakeLock?.let{if(it.isHeld)it.release()};wakeLock=null;if(!expectedStop)AcademyRtc.closeAll();(getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION); super.onDestroy() }
}
