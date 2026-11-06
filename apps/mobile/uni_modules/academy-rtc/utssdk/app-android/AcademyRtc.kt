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
    fun background(value: Boolean) { main.post { views.values.toList().forEach { it.background(value) } } }
    fun closeAll() { main.post { views.values.toList().forEach { it.leave(); close(it.id) } } }
    private class CallView(val id: String, context: android.content.Context) : FrameLayout(context) {
        private val remote = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        private val local = TextureView(context)
        private val players = linkedMapOf<String, TextureView>()
        private val activePlayers = mutableSetOf<String>()
        private val missingVideo = mutableMapOf<String, Int>()
        private val videoSizes = mutableMapOf<String, Pair<Int, Int>>()
        private var backgrounded = false
        private var keepAlive = false
        private var renewing = false
        private var lastVerified = 0L
        private var heartbeatVersion = 0
        private val heartbeat = object : Runnable {
            override fun run() {
                if (!keepAlive || owner != id) return
                if (backgrounded) renewLease()
                main.postDelayed(this, 20000)
            }
        }
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
            val size=players.keys.firstOrNull()?.let { videoSizes[it] }
            return JSONObject().put("state",status).put("error",issue).put("receiving",receiving).put("publishing",published.isNotEmpty()).put("background",backgrounded).put("backgroundReady",keepAlive && AcademyRtcService.ready).put("videoWidth",size?.first ?: 0).put("videoHeight",size?.second ?: 0).toString()
        }
        private fun permission(video: Boolean): Boolean = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED && (!video || context.checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)
        fun applyCommand(raw: String) {
            try {
                val data = JSONObject(raw)
                when(data.optString("action")) {
                    "STOP" -> stop()
                    "MUTE" -> if(owner==id) engine?.muteMicrophone(data.optBoolean("muted"))
                    "CAMERA" -> if(owner==id && permission(true)) engine?.enableCamera(data.optBoolean("enabled"))
                    "CONFIGURE" -> { configured=data; lastVerified=android.os.SystemClock.elapsedRealtime(); configure(data) }
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
                        if(roomID!=room)return
                        when(reason.name){
                            "RECONNECTING" -> {status="RECONNECTING";receiving=false;activePlayers.clear();issue="网络波动，正在恢复连接"}
                            "RECONNECTED","LOGINED" -> {status=if(published.isEmpty())"CONNECTED" else "PUBLISHING";issue=""}
                            "LOGIN_FAILED","RECONNECT_FAILED","KICK_OUT","KICKOUT" -> {status="ERROR";receiving=false;activePlayers.clear();issue="直播连接已中断，请重新进入";stopCapture()}
                            else -> if(errorCode!=0){status="RECONNECTING";receiving=false;activePlayers.clear();issue="网络波动，正在恢复连接"}
                        }
                    }
                    override fun onPublisherStateUpdate(streamID:String,state:ZegoPublisherState,errorCode:Int,extendedData:JSONObject){if(owner==id){if(errorCode!=0){status="ERROR";issue="推流中断，请检查网络后重试";stopCapture()}else if(state==ZegoPublisherState.PUBLISHING)status="PUBLISHING"}}
                    override fun onPlayerRecvAudioFirstFrame(streamID:String){if(!requiresVideo(streamID))markPlaying(streamID)}
                    override fun onPlayerRenderVideoFirstFrame(streamID:String){markPlaying(streamID)}
                    override fun onPlayerVideoSizeChanged(streamID:String,width:Int,height:Int){if(owner==id && players.containsKey(streamID))videoSizes[streamID]=Pair(width,height)}
                    override fun onPlayerQualityUpdate(streamID:String,quality:ZegoPlayStreamQuality){
                        if(owner!=id || !players.containsKey(streamID) || !requiresVideo(streamID))return
                        if(quality.videoRenderFPS>0){missingVideo.remove(streamID);markPlaying(streamID)}
                        else if(!backgrounded){val count=(missingVideo[streamID]?:0)+1;missingVideo[streamID]=count;if(count>=3){activePlayers.remove(streamID);receiving=false;status="ERROR";issue="已连接但没有可解码画面，请检查 OBS 的 H.264、B 帧 0 和关键帧 2 秒设置"}}
                    }
                    override fun onPlayerStateUpdate(streamID:String,state:ZegoPlayerState,errorCode:Int,extendedData:JSONObject){
                        if(owner!=id || !players.containsKey(streamID))return
                        if(state!=ZegoPlayerState.PLAYING || errorCode!=0){activePlayers.remove(streamID);receiving=activePlayers.isNotEmpty();if(!receiving && published.isEmpty()){status=if(errorCode!=0)"ERROR" else "CONNECTED";issue=if(errorCode!=0)"主讲画面暂时中断，正在等待恢复" else ""}}
                    }
                })
                if(data.optString("mode")=="LIVE"){engine?.enableCheckPoc(false);engine?.enableHardwareDecoder(false)}
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
            sdk.muteAllPlayAudioStreams(data.optBoolean("speakerMuted"))
            val desired=data.getJSONArray("playStreamIds");val ids=(0 until desired.length()).map{desired.getString(it)}.take(2)
            for(stream in players.keys.toList())if(stream !in ids){sdk.stopPlayingStream(stream);remote.removeView(players.remove(stream));activePlayers.remove(stream)}
            receiving=activePlayers.isNotEmpty()
            for(stream in ids)if(!players.containsKey(stream)){val texture=TextureView(context);players[stream]=texture;remote.addView(texture,LinearLayout.LayoutParams(-1,0,1f));sdk.startPlayingStream(stream,ZegoCanvas(texture).apply { viewMode=if(data.optString("canvasFit")=="cover") ZegoViewMode.ASPECT_FILL else ZegoViewMode.ASPECT_FIT })}
            for((stream,texture) in players)sdk.updatePlayingCanvas(stream,ZegoCanvas(texture).apply { viewMode=if(data.optString("canvasFit")=="cover") ZegoViewMode.ASPECT_FILL else ZegoViewMode.ASPECT_FIT })
            val next=if(data.optBoolean("publishConsent"))data.optString("publishStreamId") else ""
            if(next!=published) { stopCapture();if(next.isNotEmpty() && permission(data.optBoolean("video",true))){sdk.muteMicrophone(false);sdk.enableCamera(data.optBoolean("video",true) && !backgrounded);local.visibility=if(data.optBoolean("video",true) && !backgrounded)View.VISIBLE else View.GONE;sdk.startPreview(ZegoCanvas(local));sdk.startPublishingStream(next);published=next} }
            if(published.isNotEmpty() && permission(data.optBoolean("video",true))) {
                val video=data.optBoolean("video",true) && !backgrounded;sdk.enableCamera(video);local.visibility=if(video)View.VISIBLE else View.GONE
                if(video)sdk.startPreview(ZegoCanvas(local)) else sdk.stopPreview()
            }
            if(receiving || published.isNotEmpty())issue=""
            updateKeepAlive(data)
        }
        private fun requiresVideo(stream:String)=configured?.optBoolean("requireVideo",false)==true && stream.startsWith("lecture_")
        private fun markPlaying(stream:String){if(owner==id && players.containsKey(stream)){activePlayers.add(stream);receiving=true;issue="";status=if(published.isEmpty())"PLAYING" else "PUBLISHING"}}
        private fun updateKeepAlive(data:JSONObject){
            if(data.optString("mode")!="LIVE" || !data.optBoolean("backgroundEnabled")){stopKeepAlive();return}
            if(backgrounded)return
            try {
                AcademyRtcService.start(context,published.isNotEmpty())
                if(!keepAlive){keepAlive=true;main.postDelayed(heartbeat,20000)}
            } catch (_:Exception){keepAlive=false;issue="系统未允许后台播放，切换应用后将暂停；返回可重连"}
        }
        fun background(value:Boolean){
            backgrounded=value
            if(value){
                if(!keepAlive){stop();return}
                engine?.enableCamera(false);engine?.stopPreview();local.visibility=View.GONE
                renewLease()
            }else configured?.let{configure(it)}
        }
        private fun stopKeepAlive(){val active=keepAlive;keepAlive=false;heartbeatVersion++;main.removeCallbacks(heartbeat);if(active)AcademyRtcService.finish(context)}
        fun leave(){
            val data=configured?:return
            val endpoint=data.optString("renewUrl").replace("/refresh","/leave");val key=data.optString("leaseKey")
            if(!endpoint.startsWith("https://") || key.length!=43)return
            Thread {
                try { val connection=java.net.URL(endpoint).openConnection() as javax.net.ssl.HttpsURLConnection
                    try {connection.connectTimeout=5000;connection.readTimeout=5000;connection.instanceFollowRedirects=false;connection.requestMethod="POST";connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use{it.write(JSONObject().put("key",key).toString().toByteArray(Charsets.UTF_8))};connection.responseCode}finally{connection.disconnect()}
                }catch(_:Exception){}
            }.apply{isDaemon=true;name="academy-rtc-leave"}.start()
        }
        private fun renewLease(){
            val data=configured?:return
            if(renewing || !keepAlive || owner!=id)return
            val version=heartbeatVersion
            val endpoint=data.optString("renewUrl");val key=data.optString("leaseKey")
            if(!endpoint.startsWith("https://") || key.length!=43){issue="后台连接配置不完整";stop();return}
            renewing=true
            Thread {
                var code=0;var next:JSONObject?=null
                try {
                    val connection=java.net.URL(endpoint).openConnection() as javax.net.ssl.HttpsURLConnection
                    try {
                        connection.connectTimeout=8000;connection.readTimeout=8000;connection.instanceFollowRedirects=false
                        connection.requestMethod="POST";connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json")
                        connection.outputStream.use{it.write(JSONObject().put("key",key).put("watching",false).toString().toByteArray(Charsets.UTF_8))}
                        code=connection.responseCode
                        if(code in 200..299)next=JSONObject(connection.inputStream.bufferedReader().use{it.readText()})
                    }finally{connection.disconnect()}
                }catch(_:Exception){}
                main.post {
                    renewing=false
                    if(version!=heartbeatVersion || !keepAlive || owner!=id)return@post
                    val fresh=next
                    if(fresh!=null){
                        lastVerified=android.os.SystemClock.elapsedRealtime()
                        val current=configured?:return@post
                        // Revoked mic credentials must immediately stop capture, even while JS is suspended.
                        for(name in listOf("token","playStreamIds","publishStreamId","role"))current.put(name,fresh.opt(name))
                        if(fresh.isNull("publishStreamId"))current.put("publishConsent",false)
                        configure(current)
                    }else if(code in listOf(400,401,403,404,409) || android.os.SystemClock.elapsedRealtime()-lastVerified>=60000){
                        stop();issue="后台连接已结束，请返回直播间重新连接";status="ERROR"
                    }
                }
            }.apply{isDaemon=true;name="academy-rtc-renew"}.start()
        }
        private fun stopCapture(){if(owner!=id)return;engine?.stopPublishingStream();engine?.stopPreview();engine?.enableCamera(false);engine?.muteMicrophone(true);published="";local.visibility=View.GONE}
        fun stop(){
            stopKeepAlive()
            if(owner==id){stopCapture();for(stream in players.keys)engine?.stopPlayingStream(stream);engine?.logoutRoom(room);owner=null;destroying=true;ZegoExpressEngine.destroyEngine{ main.post{engine=null;destroying=false} }}
            players.clear();activePlayers.clear();missingVideo.clear();videoSizes.clear();remote.removeAllViews();room="";joining=false;configured=null;receiving=false;status="CLOSED"
        }
        override fun onDetachedFromWindow(){if(!keepAlive)stop();super.onDetachedFromWindow()}
    }
}
