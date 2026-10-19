package uts.sdk.modules.academyOffline

import android.app.Activity
import android.content.Intent
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.os.Bundle
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.Toast
import android.widget.TextView
import android.view.Gravity
import io.dcloud.uts.UTSAndroid
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.text.SimpleDateFormat
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object AcademyOffline {
    const val CHUNK = 4*1024*1024
    private const val alias="academy.offline.v1"
    @Volatile private var owner=""
    @Volatile private var api=""
    private var keys=JSONObject()
    private var worker:Thread?=null;private var cancel=AtomicBoolean(false)
    private var downloadId="";private var player:AcademyOfflinePlayer?=null
    @Volatile private var generation=0
    @Volatile private var clock:JSONObject?=null
    @Volatile private var connection:HttpURLConnection?=null
    private val root:File get()=File(UTSAndroid.getAppContext()!!.noBackupFilesDir,"academy-offline").apply{mkdirs()}
    private fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
    private fun userRoot():File {require(owner.isNotEmpty());return File(root,hash((api+"|"+owner).toByteArray())).apply{mkdirs()}}
    private fun folder(id:String):File{require(Regex("^[a-fA-F0-9-]{36}$").matches(id));return File(userRoot(),id)}
    private fun atomic(file:File,data:ByteArray){file.parentFile?.mkdirs();val target=AtomicFile(file);val stream=target.startWrite();try{stream.write(data);target.finishWrite(stream)}catch(e:Exception){target.failWrite(stream);throw e}}
    private fun secret():SecretKey{val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};(store.getKey(alias,null) as? SecretKey)?.let{return it};return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())}.generateKey()}
    private fun seal(value:ByteArray,aad:String):ByteArray{val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,secret());cipher.updateAAD(aad.toByteArray());return cipher.iv+cipher.doFinal(value)}
    private fun unseal(value:ByteArray,aad:String):ByteArray{require(value.size>=28);val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,secret(),GCMParameterSpec(128,value.copyOfRange(0,12)));cipher.updateAAD(aad.toByteArray());return cipher.doFinal(value.copyOfRange(12,value.size))}
    private fun millis(text:String):Long=SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",java.util.Locale.US).apply{timeZone=TimeZone.getTimeZone("UTC");isLenient=false}.parse(text)!!.time
    private fun b64(value:String)=Base64.decode(value,Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private fun result(block:()->Any?):String=try{JSONObject().put("ok",true).put("value",block()?:JSONObject.NULL).toString()}catch(e:Exception){JSONObject().put("ok",false).put("error",e.message?:"离线课件暂不可用，请联网后重试").toString()}
    @Synchronized fun configure(user:String,base:String,trustedKeys:String):String=result{
        if(user!=owner || base!=api){generation++;cancel.set(true);connection?.disconnect();player?.finish();player=null;if(owner.isNotEmpty()){val previous=userRoot();previous.deleteRecursively()};owner=user;api=base}
        val uri=URI(base);require(uri.scheme=="https" || uri.scheme=="http" && uri.host in listOf("127.0.0.1","localhost","10.0.2.2")){"离线下载仅支持安全的书院地址"};keys=JSONObject(trustedKeys);JSONObject().put("deviceId",deviceId())
    }
    private fun deviceId():String{val target=File(root,"device");if(!target.exists())atomic(target,UUID.randomUUID().toString().toByteArray());return target.readText()}
    private fun claims(token:String):JSONObject{
        val parts=token.split('.');require(parts.size==3 && token.length<=8192){"离线授权格式无效"};val header=JSONObject(String(b64(parts[0])));require(header.optString("alg")=="RS256" && header.optString("typ")=="academy-offline-license"){"离线签名类型无效"}
        val pem=keys.optString(header.getString("kid"));require(pem.isNotEmpty()){"该离线授权密钥不受此安装包信任，请更新App"};val encoded=pem.replace(Regex("-----[^-]+-----|\\s"),"");val publicKey=KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.decode(encoded,Base64.DEFAULT)));val verifier=Signature.getInstance("SHA256withRSA");verifier.initVerify(publicKey);verifier.update((parts[0]+"."+parts[1]).toByteArray());require(verifier.verify(b64(parts[2]))){"离线授权签名不正确"}
        val data=JSONObject(String(b64(parts[1])));require(data.getInt("v")==1 && data.getString("purpose")=="academy-offline-lesson" && data.getString("userId")==owner && data.getLong("bytes") in 1..2147483647L && Regex("^[a-f0-9]{64}$").matches(data.getString("sha256"))){"此课件不属于当前账号"};require(millis(data.getString("expiresAt"))-millis(data.getString("issuedAt")) in 1..72*3600000L){"离线授权期限无效"};return data
    }
    private fun clockFile()=File(root,"clock")
    private fun advanceClock(issued:Long){val target=clockFile();val previous=clock?:if(target.exists())JSONObject(String(unseal(target.readBytes(),"offline-clock")))else null;if(previous==null||issued>previous.getLong("server")){val data=JSONObject().put("server",issued).put("mono",SystemClock.elapsedRealtime()).put("wall",System.currentTimeMillis());atomic(target,seal(data.toString().toByteArray(),"offline-clock"));clock=data}else clock=previous}
    private fun trustedNow():Long{val data=clock?:JSONObject(String(unseal(clockFile().readBytes(),"offline-clock"))).also{clock=it};val elapsed=SystemClock.elapsedRealtime()-data.getLong("mono");val wall=System.currentTimeMillis()-data.getLong("wall");require(elapsed>=0 && kotlin.math.abs(elapsed-wall)<60000){"设备重启或时间变化，请联网刷新离线授权"};return data.getLong("server")+elapsed}
    private fun metadata(id:String)=JSONObject(String(unseal(File(folder(id),"lesson.json").readBytes(),"meta|$api|$owner|$id")))
    private fun save(id:String,data:JSONObject)=atomic(File(folder(id),"lesson.json"),seal(data.toString().toByteArray(),"meta|$api|$owner|$id"))
    private fun validate(data:JSONObject):JSONObject{val claims=claims(data.getString("licenseToken"));require(listOf("id","deviceHash","sha256","bytes","lessonId","releaseId","assetId","mime").all{claims.get(it)==data.get(it)}){"课件设备或文件信息不匹配"};require(millis(claims.getString("expiresAt"))>trustedNow()){"离线授权已到期，请联网刷新"};return claims}
    private fun aad(data:JSONObject,index:Int)=owner+"|"+data.getString("sha256")+"|"+index
    fun chunk(data:JSONObject,index:Int):ByteArray {validate(data);return unseal(File(folder(data.getString("id")),"$index.bin").readBytes(),aad(data,index))}
    @Synchronized fun command(action:String,payload:String):String=result{
        val data=JSONObject(payload)
        when(action){
            "LIST"->{val rows=JSONArray();userRoot().listFiles()?.filter{it.isDirectory}?.forEach{file->try{val item=metadata(file.name);if(item.optString("state")=="DOWNLOADING" && worker?.isAlive!=true){item.put("state","PAUSED");save(file.name,item)};item.remove("licenseToken");rows.put(item)}catch(_:Exception){rows.put(JSONObject().put("id",file.name).put("title","损坏的离线课件").put("state","FAILED").put("error","请删除后重新下载"))}};JSONObject().put("items",rows).put("deviceId",deviceId())}
            "START"->{start(data);null}
            "STATUS"->{val item=metadata(data.getString("id"));item.remove("licenseToken");item}
            "PAUSE"->{if(downloadId==data.getString("id")){cancel.set(true);connection?.disconnect()};null}
            "DELETE"->{val id=data.getString("id");require(downloadId!=id || worker?.isAlive!=true){"请先暂停下载后再删除"};player?.finish();folder(id).deleteRecursively();null}
            "RENEW"->{val id=data.getString("id");val item=metadata(id);val signed=claims(data.getString("licenseToken"));require(signed.getString("id")==id && signed.getString("sha256")==item.getString("sha256") && signed.getInt("version")>=item.getInt("version")){"课件版本已变化，请重新下载"};advanceClock(millis(signed.getString("issuedAt")));item.put("licenseToken",data.getString("licenseToken")).put("version",signed.getInt("version")).put("expiresAt",signed.getString("expiresAt"));save(id,item);null}
            "PLAY"->{val id=data.getString("id");val item=metadata(id);validate(item);require(item.getString("state")=="READY"){"请先完成课件下载"};val activity=UTSAndroid.getUniActivity()?:error("页面不可用");activity.startActivity(Intent(activity,AcademyOfflinePlayer::class.java).putExtra("lesson",id).putExtra("title",item.optString("title","离线课件")).putExtra("audio",item.optString("mime").startsWith("audio/")));null}
            else->error("不支持的离线操作")
        }
    }
    private fun start(input:JSONObject){
        require(worker?.isAlive!=true){"请等待当前下载停止后再操作"};val token=input.getString("licenseToken");val signed=claims(token);val id=signed.getString("id");val bearer=input.getString("accessToken");require(input.getString("deviceId")==deviceId()){"设备标识已变化"}
        advanceClock(millis(signed.getString("issuedAt")));val dir=folder(id).apply{mkdirs()};val old=if(File(dir,"lesson.json").exists())metadata(id)else null;require(old==null || old.getString("sha256")==signed.getString("sha256")){"文件版本已变化"}
        val item=JSONObject(signed.toString()).put("licenseToken",token).put("deviceHash",signed.getString("deviceHash")).put("title",input.optString("title","研习课件")).put("courseTitle",input.optString("courseTitle","书院课程")).put("state","DOWNLOADING").put("receivedBytes",0).put("error","")
        save(id,item);cancel=AtomicBoolean(false);val signal=cancel;val user=owner;val endpoint=api;val run=generation;downloadId=id
        worker=Thread{
            try{
                validate(item);val total=item.getLong("bytes");val count=((total+CHUNK-1)/CHUNK).toInt();var received=0L
                for(index in 0 until count){
                    if(signal.get()||generation!=run)throw InterruptedException()
                    val target=File(dir,"$index.bin")
                    if(target.exists())try{val cached=unseal(target.readBytes(),aad(item,index));require(cached.size.toLong()==minOf(CHUNK.toLong(),total-index*CHUNK.toLong()));received+=cached.size}catch(_:Exception){target.delete()}
                    if(!target.exists()){
                        val url=java.net.URL(endpoint+"/learning/offline/licenses/$id/chunks/$index?deviceId="+deviceId());val connection=url.openConnection() as HttpURLConnection
                        AcademyOffline.connection=connection
                        connection.connectTimeout=15000;connection.readTimeout=30000;connection.instanceFollowRedirects=false;connection.setRequestProperty("Authorization","Bearer $bearer");connection.setRequestProperty("X-Offline-License",token)
                        try{if(connection.responseCode==401)error("登录凭证需刷新，请点击继续下载");require(connection.responseCode==200){if(connection.responseCode==403)"课程权限或离线授权已变化，请联网刷新" else "下载暂时中断，请点击继续下载"};val expected=minOf(CHUNK.toLong(),total-index*CHUNK.toLong()).toInt();val body=connection.inputStream.use{stream->val buffer=ByteArray(expected);var at=0;while(at<expected){val n=stream.read(buffer,at,expected-at);require(n>0){"下载分片不完整"};at+=n};require(stream.read()==-1){"下载分片大小异常"};buffer};require(hash(body)==connection.getHeaderField("X-Chunk-SHA256")){"课件分片校验失败，请重试"};if(signal.get()||owner!=user)throw InterruptedException();atomic(target,seal(body,aad(item,index)));received+=body.size}finally{connection.disconnect()}
                    }
                    synchronized(this){if(owner==user){item.put("receivedBytes",received);save(id,item)}}
                }
                val digest=MessageDigest.getInstance("SHA-256");for(index in 0 until count){if(signal.get()||owner!=user)throw InterruptedException();digest.update(unseal(File(dir,"$index.bin").readBytes(),aad(item,index)))};require(digest.digest().joinToString(""){"%02x".format(it)}==item.getString("sha256")){"整份课件校验失败，请删除后重新下载"};validate(item);item.put("state","READY")
            }catch(_:InterruptedException){item.put("state","PAUSED")}catch(e:Exception){item.put("state",if(signal.get())"PAUSED" else "FAILED").put("error",if(signal.get())"" else e.message?:"下载中断，请稍后重试")}
            finally{synchronized(this){connection=null;if(generation==run && dir.exists())save(id,item)else dir.deleteRecursively()}}
        }.apply{isDaemon=true;start()}
    }
    fun openSource(activity:AcademyOfflinePlayer,id:String):MediaDataSource{
        val item=metadata(id);validate(item);player=activity;val user=owner;val run=generation;val expiry=millis(item.getString("expiresAt"))
        return object:MediaDataSource(){private var cachedIndex=-1;private var cached=byteArrayOf();override fun getSize():Long{require(owner==user && generation==run && trustedNow()<expiry){"离线授权已变化或到期"};return item.getLong("bytes")};@Synchronized override fun readAt(position:Long,buffer:ByteArray,offset:Int,size:Int):Int{require(position>=0);val total=getSize();if(position>=total)return -1;if(size==0)return 0;val index=(position/CHUNK).toInt();if(index!=cachedIndex){cached=chunk(item,index);cachedIndex=index};val from=(position%CHUNK).toInt();val length=minOf(size,cached.size-from);cached.copyInto(buffer,offset,from,from+length);return length};override fun close(){cached.fill(0);cached=byteArrayOf()}}
    }
}

class AcademyOfflinePlayer:Activity(),MediaController.MediaPlayerControl {
    private var media:MediaPlayer?=null;private var prepared=false;private var controller:MediaController?=null
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);val frame=FrameLayout(this);frame.setBackgroundColor(android.graphics.Color.BLACK);val surface=SurfaceView(this);frame.addView(surface,FrameLayout.LayoutParams(-1,-1));
        val audioOnly=intent.getBooleanExtra("audio",false);val title=intent.getStringExtra("title")?:"离线课件"
        if(audioOnly){val cover=TextView(this);cover.text="听 · 经典\n\n"+title+"\n\n离线音频研习";cover.textSize=21f;cover.gravity=Gravity.CENTER;cover.setTextColor(android.graphics.Color.rgb(49,86,79));cover.setBackgroundColor(android.graphics.Color.rgb(250,248,242));cover.setPadding(32,80,32,100);frame.addView(cover,FrameLayout.LayoutParams(-1,-1));cover.setOnClickListener{controller?.show(0)}}
        val back=TextView(this);back.text="‹ 返回  ·  "+title;back.textSize=16f;back.setTextColor(if(audioOnly)android.graphics.Color.rgb(49,86,79) else android.graphics.Color.WHITE);back.setPadding(20,16,20,16);back.contentDescription="返回离线课件列表";back.setOnClickListener{finish()};frame.addView(back,FrameLayout.LayoutParams(-1,-2,Gravity.TOP));setContentView(frame);val id=intent.getStringExtra("lesson")?:run{finish();return};surface.holder.addCallback(object:SurfaceHolder.Callback{override fun surfaceCreated(holder:SurfaceHolder){try{media=MediaPlayer().apply{setDataSource(AcademyOffline.openSource(this@AcademyOfflinePlayer,id));setDisplay(holder);setOnPreparedListener{prepared=true;controller=MediaController(this@AcademyOfflinePlayer).apply{setMediaPlayer(this@AcademyOfflinePlayer);setAnchorView(frame);isEnabled=true};start();controller?.show(if(audioOnly)0 else 3000)};setOnErrorListener{_,_,_->Toast.makeText(this@AcademyOfflinePlayer,"课件播放失败，请联网刷新或重新下载",Toast.LENGTH_LONG).show();finish();true};prepareAsync()}}catch(_:Exception){Toast.makeText(this@AcademyOfflinePlayer,"离线授权不可用，请联网刷新",Toast.LENGTH_LONG).show();finish()}};override fun surfaceChanged(holder:SurfaceHolder,format:Int,width:Int,height:Int){};override fun surfaceDestroyed(holder:SurfaceHolder){media?.setDisplay(null)}});frame.setOnClickListener{controller?.show()}}
    override fun onPause(){media?.pause();super.onPause()}
    override fun onDestroy(){prepared=false;media?.release();media=null;super.onDestroy()}
    override fun start(){if(prepared)media?.start()};override fun pause(){if(prepared)media?.pause()};override fun getDuration():Int=if(prepared)media?.duration?:0 else 0;override fun getCurrentPosition():Int=if(prepared)media?.currentPosition?:0 else 0;override fun seekTo(pos:Int){if(prepared)media?.seekTo(pos)};override fun isPlaying():Boolean=prepared && media?.isPlaying==true;override fun getBufferPercentage()=100;override fun canPause()=true;override fun canSeekBackward()=true;override fun canSeekForward()=true;override fun getAudioSessionId():Int=media?.audioSessionId?:0
}
