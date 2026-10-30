import Foundation
import UIKit
import AVFoundation
import ZegoExpressEngine

public class AcademyRtc {
    private static var views: [String: CallView] = [:]
    fileprivate static var owner: String? = nil
    fileprivate static var destroying = false
    public static func create(_ id: String) -> UIView { let view=CallView(id);views[id]=view;return view }
    public static func command(_ id: String, _ raw: String) { DispatchQueue.main.async { views[id]?.command(raw) } }
    public static func state(_ id: String) -> String { return views[id]?.snapshot() ?? "{\"state\":\"CLOSED\"}" }
    public static func close(_ id: String) { DispatchQueue.main.async { views.removeValue(forKey:id)?.stop() } }
}
private final class CallView: UIView, ZegoEventHandler {
    let id:String
    let remote=UIStackView(),local=UIView()
    var players:[String:UIView]=[:],activePlayers=Set<String>(),room="",published="",status="IDLE",issue="",receiving=false,joining=false,configured:[String:Any]?=nil,permissionPending=false
    init(_ id:String){self.id=id;super.init(frame:.zero);backgroundColor=UIColor(red:0.106,green:0.133,blue:0.125,alpha:1);remote.axis = .vertical;remote.distribution = .fillEqually;addSubview(remote);addSubview(local);remote.translatesAutoresizingMaskIntoConstraints=false;local.translatesAutoresizingMaskIntoConstraints=false;NSLayoutConstraint.activate([remote.topAnchor.constraint(equalTo:topAnchor),remote.leadingAnchor.constraint(equalTo:leadingAnchor),remote.trailingAnchor.constraint(equalTo:trailingAnchor),remote.bottomAnchor.constraint(equalTo:bottomAnchor),local.topAnchor.constraint(equalTo:topAnchor,constant:12),local.trailingAnchor.constraint(equalTo:trailingAnchor,constant:-12),local.widthAnchor.constraint(equalToConstant:112),local.heightAnchor.constraint(equalToConstant:84)]);local.isHidden=true}
    required init?(coder:NSCoder){fatalError("init(coder:) is unavailable")}
    func snapshot()->String{let value:[String:Any]=["state":status,"error":issue,"receiving":receiving,"publishing":!published.isEmpty];return String(data:(try? JSONSerialization.data(withJSONObject:value)) ?? Data(),encoding:.utf8) ?? "{}"}
    func command(_ raw:String){guard let data=raw.data(using:.utf8),let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else{return}
        switch value["action"] as? String {
        case "STOP":stop()
        case "MUTE":if AcademyRtc.owner==id{ZegoExpressEngine.shared().muteMicrophone(value["muted"] as? Bool ?? true)}
        case "CAMERA":if AcademyRtc.owner==id,AVCaptureDevice.authorizationStatus(for:.video) == .authorized{ZegoExpressEngine.shared().enableCamera(value["enabled"] as? Bool ?? false)}
        case "CONFIGURE":configured=value;configure(value)
        default:break
        }
    }
    private func configure(_ data:[String:Any]){
        guard AcademyRtc.owner==nil || AcademyRtc.owner==id,!AcademyRtc.destroying else{status="ERROR";issue="其他通话仍在结束，请稍后重连";return}
        let consent=data["publishConsent"] as? Bool ?? false,stream=data["publishStreamId"] as? String ?? "",video=data["video"] as? Bool ?? true
        if consent && !stream.isEmpty && (AVCaptureDevice.authorizationStatus(for:.audio) != .authorized || video && AVCaptureDevice.authorizationStatus(for:.video) != .authorized){
            status="PERMISSION";issue="请在系统设置允许麦克风或摄像头权限"
            let audioState=AVCaptureDevice.authorizationStatus(for:.audio),videoState=AVCaptureDevice.authorizationStatus(for:.video)
            if audioState == .denied || audioState == .restricted || video && (videoState == .denied || videoState == .restricted){return}
            if !permissionPending{permissionPending=true;AVCaptureDevice.requestAccess(for:.audio){[weak self] audio in
                let finish:(Bool)->Void={granted in DispatchQueue.main.async{guard let self=self else{return};self.permissionPending=false;if let latest=self.configured,audio && granted{self.configure(latest)}}}
                if video && audio{AVCaptureDevice.requestAccess(for:.video,completionHandler:finish)}else{finish(audio)}
            }};return
        }
        guard let roomId=data["roomId"] as? String,let userId=data["userId"] as? String,let token=data["token"] as? String,let appId=data["appId"] as? NSNumber else{status="ERROR";issue="实时连接凭证不完整";return}
        if AcademyRtc.owner==nil{let profile=ZegoEngineProfile();profile.appID=appId.uint32Value;profile.appSign="";profile.scenario = .broadcast;ZegoExpressEngine.createEngine(with:profile,eventHandler:self);ZegoExpressEngine.shared().enableCamera(false);ZegoExpressEngine.shared().muteMicrophone(true);AcademyRtc.owner=id}
        if room.isEmpty && !joining{room=roomId;joining=true;status="CONNECTING";let config=ZegoRoomConfig();config.token=token;config.isUserStatusNotify=true;ZegoExpressEngine.shared().loginRoom(room,user:ZegoUser(userID:userId),config:config){[weak self] code,_ in
            guard let self=self,AcademyRtc.owner==self.id else{return};self.joining=false
            if code==0{self.status="CONNECTED";if let latest=self.configured{self.reconcile(latest)}}else{self.status="ERROR";self.issue="加入房间失败，请重新进入";self.stopCapture()}
        }}else if room==roomId && !joining{ZegoExpressEngine.shared().renewToken(token,roomID:room);reconcile(data)}else if room != roomId{stop();status="ERROR";issue="房间已经变化，请重新进入"}
    }
    private func reconcile(_ data:[String:Any]){
        let desired=Array((data["playStreamIds"] as? [String] ?? []).prefix(2)),engine=ZegoExpressEngine.shared()
        engine.muteAllPlayAudioStreams(data["speakerMuted"] as? Bool ?? false)
        for stream in Array(players.keys) where !desired.contains(stream){engine.stopPlayingStream(stream);players.removeValue(forKey:stream)?.removeFromSuperview();activePlayers.remove(stream)}
        receiving = !activePlayers.isEmpty
        for stream in desired where players[stream]==nil{let view=UIView();players[stream]=view;remote.addArrangedSubview(view);let canvas=ZegoCanvas(view:view);canvas.viewMode=(data["canvasFit"] as? String)=="cover" ? .aspectFill : .aspectFit;engine.startPlayingStream(stream,canvas:canvas)}
        for (stream,view) in players{let canvas=ZegoCanvas(view:view);canvas.viewMode=(data["canvasFit"] as? String)=="cover" ? .aspectFill : .aspectFit;_ = engine.updatePlayingCanvas(stream,canvas:canvas)}
        let next=(data["publishConsent"] as? Bool ?? false) ? (data["publishStreamId"] as? String ?? "") : ""
        if next != published{stopCapture();if !next.isEmpty{let video=data["video"] as? Bool ?? true;engine.muteMicrophone(false);engine.enableCamera(video);local.isHidden = !video;engine.startPreview(ZegoCanvas(view:local));engine.startPublishingStream(next);published=next}}
        if !published.isEmpty{let video=data["video"] as? Bool ?? true;engine.enableCamera(video);local.isHidden = !video;if video{engine.startPreview(ZegoCanvas(view:local))}else{engine.stopPreview()}}
        issue=""
    }
    private func stopCapture(){guard AcademyRtc.owner==id else{return};let engine=ZegoExpressEngine.shared();engine.stopPublishingStream();engine.stopPreview();engine.enableCamera(false);engine.muteMicrophone(true);published="";local.isHidden=true}
    func stop(){if AcademyRtc.owner==id{stopCapture();let engine=ZegoExpressEngine.shared();for stream in players.keys{engine.stopPlayingStream(stream)};engine.logoutRoom(room);AcademyRtc.owner=nil;AcademyRtc.destroying=true;ZegoExpressEngine.destroyEngine{AcademyRtc.destroying=false}};for view in players.values{view.removeFromSuperview()};players.removeAll();activePlayers.removeAll();room="";configured=nil;receiving=false;status="CLOSED"}
    func onRoomStateChanged(_ reason:ZegoRoomStateChangedReason,errorCode:Int32,extendedData:[AnyHashable:Any],roomID:String){
        guard AcademyRtc.owner==id,roomID==room else{return}
        switch reason {
        case .reconnecting:status="RECONNECTING";receiving=false;activePlayers.removeAll();issue="网络波动，正在恢复连接"
        case .reconnected,.logined:status=published.isEmpty ? "CONNECTED":"PUBLISHING";issue=""
        case .loginFailed,.reconnectFailed,.kickOut:status="ERROR";receiving=false;activePlayers.removeAll();issue="连接已中断，请重新进入";stopCapture()
        default:if errorCode != 0{status="RECONNECTING";receiving=false;activePlayers.removeAll();issue="网络波动，正在恢复连接"}
        }
    }
    func onPublisherStateUpdate(_ state:ZegoPublisherState,errorCode:Int32,extendedData:[AnyHashable:Any],streamID:String){guard AcademyRtc.owner==id else{return};if errorCode != 0{status="ERROR";issue="推流中断，请重试";stopCapture()}else if state == .publishing{status="PUBLISHING"}}
    func onPlayerRecvAudioFirstFrame(_ streamID:String){guard AcademyRtc.owner==id,players[streamID] != nil else{return};activePlayers.insert(streamID);receiving=true;issue="";status=published.isEmpty ? "PLAYING":"PUBLISHING"}
    func onPlayerRecvVideoFirstFrame(_ streamID:String){guard AcademyRtc.owner==id,players[streamID] != nil else{return};activePlayers.insert(streamID);receiving=true;issue="";status=published.isEmpty ? "PLAYING":"PUBLISHING"}
    func onPlayerStateUpdate(_ state:ZegoPlayerState,errorCode:Int32,extendedData:[AnyHashable:Any],streamID:String){
        guard AcademyRtc.owner==id,players[streamID] != nil else{return}
        if state == .playing{activePlayers.insert(streamID);receiving=true;issue="";status=published.isEmpty ? "PLAYING":"PUBLISHING"}
        else{activePlayers.remove(streamID);receiving = !activePlayers.isEmpty;if !receiving && published.isEmpty{status="CONNECTED";issue=errorCode != 0 ? "主讲画面暂时中断，正在等待恢复":""}}
    }
    override func didMoveToWindow(){super.didMoveToWindow();if window==nil{stop()}}
}
