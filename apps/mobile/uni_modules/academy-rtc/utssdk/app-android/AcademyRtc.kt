package uts.sdk.modules.academyRtc

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import io.dcloud.uts.UTSAndroid
import im.zego.zegoexpress.ZegoExpressEngine
import im.zego.zegoexpress.callback.IZegoEventHandler
import im.zego.zegoexpress.constants.*
import im.zego.zegoexpress.entity.*
import org.json.JSONObject

object AcademyRtc {
    private val main = Handler(Looper.getMainLooper())
    private val views = mutableMapOf<String, CallView>()
    private var owner: String? = null
    private var engine: ZegoExpressEngine? = null
    private var destroying = false
    fun create(id: String): View {
        val context = UTSAndroid.getAppContext() ?: error("Context unavailable")
        return CallView(id, context).also { views[id] = it }
    }
    fun command(id: String, json: String) { main.post { views[id]?.applyCommand(json) } }
    fun state(id: String): String = views[id]?.snapshot() ?: "{\"state\":\"CLOSED\"}"
    fun close(id: String) { main.post { views.remove(id)?.stop() } }
    private class CallView(val id: String, context: android.content.Context) : FrameLayout(context) {
        private val remote = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        private val local = TextureView(context)
        private val players = linkedMapOf<String, TextureView>()
        private var room = ""
        private var published = ""
        private var configured: JSONObject? = null
        @Volatile private var status = "IDLE"
        @Volatile private var issue = ""
        @Volatile private var receiving = false
        private var permissionRequested = false
        private var joining = false
        init {
            setBackgroundColor(Color.rgb(27, 34, 32))
            addView(remote, LayoutParams(-1, -1))
            val density = resources.displayMetrics.density
            addView(local, LayoutParams((112*density).toInt(), (84*density).toInt(), Gravity.TOP or Gravity.END).apply { setMargins(0,(12*density).toInt(),(12*density).toInt(),0) })
            local.visibility = View.GONE
        }
        fun snapshot(): String {
            if(status=="PERMISSION")configured?.let { if(permission(it.optBoolean("video",true)))main.post{configured?.let{data->configure(data)}} }
            return JSONObject().put("state",status).put("error",issue).put("receiving",receiving).put("publishing",published.isNotEmpty()).toString()
        }
        private fun permission(video: Boolean): Boolean = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED && (!video || context.checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)
        fun applyCommand(raw: String) {
            try {
                val data = JSONObject(raw)
                when(data.optString("action")) {
                    "STOP" -> stop()
                    "MUTE" -> if(owner==id) engine?.muteMicrophone(data.optBoolean("muted"))
                    "CAMERA" -> if(owner==id && permission(true)) engine?.enableCamera(data.optBoolean("enabled"))
                    "CONFIGURE" -> { configured=data; configure(data) }
                }
            } catch (_: Exception) { issue="音视频连接暂时失败，请重新连接";status="ERROR";stopCapture() }
        }
        private fun configure(data: JSONObject) {
            if(owner!=null && owner!=id || destroying) { status="ERROR";issue="其他通话仍在结束，请稍后重新连接";return }
            val publishing=data.optString("publishStreamId");val video=data.optBoolean("video",true);val consent=data.optBoolean("publishConsent")
            if(publishing.isNotEmpty() && consent && !permission(video)) {
                status="PERMISSION";issue="请允许麦克风权限；视频开播还需摄像头权限"
                if(!permissionRequested){permissionRequested=true;UTSAndroid.getUniActivity()?.requestPermissions(if(video) arrayOf(Manifest.permission.RECORD_AUDIO,Manifest.permission.CAMERA) else arrayOf(Manifest.permission.RECORD_AUDIO),7634)}
                return
            }
            permissionRequested=false
            if(engine==null) {
                val profile=ZegoEngineProfile().apply { appID=data.getLong("appId");appSign="";scenario=ZegoScenario.BROADCAST;application=context.applicationContext as Application }
                engine=ZegoExpressEngine.createEngine(profile,object: IZegoEventHandler(){
                    override fun onRoomStateChanged(roomID:String, reason:ZegoRoomStateChangedReason, errorCode:Int, extendedData:JSONObject){
                        if(owner!=id)return
                        if(errorCode!=0){status="ERROR";issue="直播连接中断，请重新连接";stopCapture()}
                    }
                    override fun onPublisherStateUpdate(streamID:String,state:ZegoPublisherState,errorCode:Int,extendedData:JSONObject){if(owner==id){if(errorCode!=0){status="ERROR";issue="推流中断，请检查网络后重试";stopCapture()}else if(state==ZegoPublisherState.PUBLISHING)status="PUBLISHING"}}
                    override fun onPlayerRecvAudioFirstFrame(streamID:String){if(owner==id){receiving=true;status=if(published.isEmpty())"PLAYING" else "PUBLISHING"}}
                    override fun onPlayerRecvVideoFirstFrame(streamID:String){if(owner==id){receiving=true;status=if(published.isEmpty())"PLAYING" else "PUBLISHING"}}
                    override fun onPlayerStateUpdate(streamID:String,state:ZegoPlayerState,errorCode:Int,extendedData:JSONObject){if(owner==id && errorCode!=0){issue="远端画面暂未到达，正在等待对方连接"}}
                })
                engine?.enableCamera(false);engine?.muteMicrophone(true)
            }
            owner=id
            val nextRoom=data.getString("roomId")
            if(room.isEmpty() && !joining) {
                joining=true;status="CONNECTING";room=nextRoom
                val config=ZegoRoomConfig().apply { token=data.getString("token");isUserStatusNotify=true }
                engine!!.loginRoom(room,ZegoUser(data.getString("userId")),config){code,_ ->
                    joining=false;if(owner!=id)return@loginRoom
                    if(code==0){status="CONNECTED";configured?.let{reconcile(it)}}else{status="ERROR";issue="加入直播失败，请重新进入";stopCapture()}
                }
            } else if(room==nextRoom && !joining) { engine?.renewToken(room,data.getString("token"));reconcile(data) }
            else if(room!=nextRoom) { stop();status="ERROR";issue="房间已经变化，请重新进入" }
        }
        private fun reconcile(data:JSONObject) {
            val sdk=engine?:return
            val desired=data.getJSONArray("playStreamIds");val ids=(0 until desired.length()).map{desired.getString(it)}.take(2)
            for(stream in players.keys.toList())if(stream !in ids){sdk.stopPlayingStream(stream);remote.removeView(players.remove(stream))}
            for(stream in ids)if(!players.containsKey(stream)){val texture=TextureView(context);players[stream]=texture;remote.addView(texture,LinearLayout.LayoutParams(-1,0,1f));sdk.startPlayingStream(stream,ZegoCanvas(texture))}
            val next=if(data.optBoolean("publishConsent"))data.optString("publishStreamId") else ""
            if(next!=published) { stopCapture();if(next.isNotEmpty() && permission(data.optBoolean("video",true))){sdk.muteMicrophone(false);sdk.enableCamera(data.optBoolean("video",true));local.visibility=if(data.optBoolean("video",true))View.VISIBLE else View.GONE;sdk.startPreview(ZegoCanvas(local));sdk.startPublishingStream(next);published=next} }
            if(published.isNotEmpty() && permission(data.optBoolean("video",true))) {
                val video=data.optBoolean("video",true);sdk.enableCamera(video);local.visibility=if(video)View.VISIBLE else View.GONE
                if(video)sdk.startPreview(ZegoCanvas(local)) else sdk.stopPreview()
            }
            issue=""
        }
        private fun stopCapture(){if(owner!=id)return;engine?.stopPublishingStream();engine?.stopPreview();engine?.enableCamera(false);engine?.muteMicrophone(true);published="";local.visibility=View.GONE}
        fun stop(){
            if(owner==id){stopCapture();for(stream in players.keys)engine?.stopPlayingStream(stream);engine?.logoutRoom(room);owner=null;destroying=true;ZegoExpressEngine.destroyEngine{ main.post{engine=null;destroying=false} }}
            players.clear();remote.removeAllViews();room="";joining=false;configured=null;receiving=false;status="CLOSED"
        }
        override fun onDetachedFromWindow(){stop();super.onDetachedFromWindow()}
    }
}
