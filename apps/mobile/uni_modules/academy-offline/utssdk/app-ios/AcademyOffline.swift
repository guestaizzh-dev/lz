import Foundation
import UIKit
import AVFoundation
import AVKit
import CryptoKit
import Security

private struct OfflineIssue:Error {let text:String}
public class AcademyOffline {
    fileprivate static let chunkBytes=4*1024*1024
    private static let lock=NSRecursiveLock(),queue=DispatchQueue(label:"academy.offline.download")
    private static var owner="",api="",keys:[String:String]=[:],generation=0,working=false,cancelled=false,downloadId=""
    private static var network:URLSessionDataTask?=nil,player:AVPlayerViewController?=nil,loader:OfflineLoader?=nil
    private static var clock:[String:Any]?=nil
    private static var root:URL {let url=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("academy-offline",isDirectory:true);try? FileManager.default.createDirectory(at:url,withIntermediateDirectories:true);var mutable=url;var values=URLResourceValues();values.isExcludedFromBackup=true;try? mutable.setResourceValues(values);return url}
    private static func fail(_ text:String)throws->Never{throw OfflineIssue(text:text)}
    private static func synchronized<T>(_ block:()throws->T)rethrows->T{lock.lock();defer{lock.unlock()};return try block()}
    private static func hash(_ data:Data)->String{SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}
    private static func userRoot()throws->URL{guard !owner.isEmpty else{try fail("请先登录当前账号")};let url=root.appendingPathComponent(hash(Data((api+"|"+owner).utf8)),isDirectory:true);try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true);return url}
    private static func folder(_ id:String)throws->URL{guard UUID(uuidString:id) != nil else{try fail("课件编号无效")};return try userRoot().appendingPathComponent(id,isDirectory:true)}
    private static func write(_ data:Data,to url:URL)throws{try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true);try data.write(to:url,options:[.atomic,.completeFileProtection])}
    private static func key()throws->SymmetricKey{
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:(Bundle.main.bundleIdentifier ?? "academy")+".offline.v1",kSecAttrAccount as String:"media-key",kSecAttrSynchronizable as String:false]
        var request=query;request[kSecReturnData as String]=true;request[kSecMatchLimit as String]=kSecMatchLimitOne;var value:CFTypeRef?;let status=SecItemCopyMatching(request as CFDictionary,&value)
        if status==errSecSuccess,let data=value as? Data,data.count==32{return SymmetricKey(data:data)}
        guard status==errSecItemNotFound else{try fail("请解锁设备后读取离线课件")};let key=SymmetricKey(size:.bits256),data=key.withUnsafeBytes{Data($0)};var item=query;item[kSecValueData as String]=data;item[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly;guard SecItemAdd(item as CFDictionary,nil)==errSecSuccess else{try fail("安全密钥保存失败")};return key
    }
    private static func seal(_ data:Data,_ aad:String)throws->Data{guard let combined=try AES.GCM.seal(data,using:key(),authenticating:Data(aad.utf8)).combined else{try fail("课件加密失败")};return combined}
    private static func unseal(_ data:Data,_ aad:String)throws->Data{try AES.GCM.open(AES.GCM.SealedBox(combined:data),using:key(),authenticating:Data(aad.utf8))}
    private static func json(_ data:Data)throws->[String:Any]{guard let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{try fail("离线信息不完整")};return value}
    private static func encoded(_ value:[String:Any])throws->Data{try JSONSerialization.data(withJSONObject:value)}
    private static func millis(_ text:String)throws->Double{let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds];guard let date=formatter.date(from:text) else{try fail("授权时间无效")};return date.timeIntervalSince1970*1000}
    private static func b64(_ text:String)throws->Data{let fixed=text.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");guard let data=Data(base64Encoded:fixed+String(repeating:"=",count:(4-fixed.count%4)%4)) else{try fail("签名格式无效")};return data}
    private static func claims(_ token:String)throws->[String:Any]{
        let parts=token.components(separatedBy:".");guard parts.count==3,token.count<=8192 else{try fail("离线授权格式无效")};let header=try json(b64(parts[0]));guard header["alg"] as? String=="RS256",header["typ"] as? String=="academy-offline-license",let kid=header["kid"] as? String,let pem=keys[kid] else{try fail("此安装包不信任该授权密钥，请更新App")}
        let compact=pem.replacingOccurrences(of:"-----BEGIN PUBLIC KEY-----",with:"").replacingOccurrences(of:"-----END PUBLIC KEY-----",with:"").components(separatedBy:.whitespacesAndNewlines).joined();guard let spki=Data(base64Encoded:compact) else{try fail("公钥格式无效")}
        // SecKey imports PKCS#1 RSA data; unwrap the standard SPKI BIT STRING, never a network-supplied key.
        let pkcs1=try rsaPublicBytes(spki);let attrs:[String:Any]=[kSecAttrKeyType as String:kSecAttrKeyTypeRSA,kSecAttrKeyClass as String:kSecAttrKeyClassPublic];guard let publicKey=SecKeyCreateWithData(pkcs1 as CFData,attrs as CFDictionary,nil),SecKeyVerifySignature(publicKey,.rsaSignatureMessagePKCS1v15SHA256,Data((parts[0]+"."+parts[1]).utf8) as CFData,try b64(parts[2]) as CFData,nil) else{try fail("离线授权签名不正确")}
        let result=try json(b64(parts[1]));guard result["v"] as? Int==1,result["purpose"] as? String=="academy-offline-lesson",result["userId"] as? String==owner,let size=result["bytes"] as? Int,size>0,size<=2147483647,let checksum=result["sha256"] as? String,checksum.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,let issued=result["issuedAt"] as? String,let expires=result["expiresAt"] as? String,(result["version"] as? Int ?? 0)>0 else{try fail("此课件不属于当前账号")};for field in ["id","assetId","lessonId","releaseId"]{guard let value=result[field] as? String,UUID(uuidString:value) != nil else{try fail("离线授权标识不完整")}};guard let deviceHash=result["deviceHash"] as? String,deviceHash.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,["video/mp4","audio/mp4"].contains(result["mime"] as? String ?? "") else{try fail("离线课件信息不完整")};let window=try millis(expires)-millis(issued);guard window>0,window<=72*3600000 else{try fail("离线授权期限无效")};return result
    }
    private static func rsaPublicBytes(_ data:Data)throws->Data{let bytes=[UInt8](data);var at=0
        func length()throws->Int{guard at<bytes.count else{try fail("公钥格式无效")};let first=Int(bytes[at]);at+=1;if first<128{return first};let n=first&127;guard n>0,n<=4,at+n<=bytes.count else{try fail("公钥格式无效")};var value=0;for _ in 0..<n{value=value*256+Int(bytes[at]);at+=1};return value}
        guard bytes.first==0x30 else{try fail("公钥格式无效")};at=1;_=try length();guard at<bytes.count,bytes[at]==0x30 else{try fail("公钥格式无效")};at+=1;let algorithm=try length();at+=algorithm;guard at<bytes.count,bytes[at]==0x03 else{try fail("公钥格式无效")};at+=1;let size=try length();guard size>1,at+size<=bytes.count,bytes[at]==0 else{try fail("公钥格式无效")};return Data(bytes[(at+1)..<(at+size)])}
    private static func advance(_ issued:Double)throws{let target=root.appendingPathComponent("clock");let previous=clock ?? (try? json(unseal(Data(contentsOf:target),"offline-clock")));if previous==nil || issued>(previous?["server"] as? Double ?? 0){let next:[String:Any]=["server":issued,"mono":ProcessInfo.processInfo.systemUptime*1000,"wall":Date().timeIntervalSince1970*1000];try write(seal(encoded(next),"offline-clock"),to:target);clock=next}else{clock=previous}}
    private static func now()throws->Double{let state=try clock ?? json(unseal(Data(contentsOf:root.appendingPathComponent("clock")),"offline-clock"));clock=state;guard let mono=state["mono"] as? Double,let wall=state["wall"] as? Double,let server=state["server"] as? Double else{try fail("请联网刷新离线授权")};let elapsed=ProcessInfo.processInfo.systemUptime*1000-mono;guard elapsed>=0,abs(Date().timeIntervalSince1970*1000-wall-elapsed)<60000 else{try fail("设备重启或时间变化，请联网刷新离线授权")};return server+elapsed}
    fileprivate static func playbackAllowed(_ item:[String:Any])throws{try synchronized{guard item["userId"] as? String==owner,try millis(item["expiresAt"] as? String ?? "")>now() else{try fail("离线授权已变化或到期")}}}
    fileprivate static func closed(){player=nil;loader=nil}
    private static func metadata(_ id:String)throws->[String:Any]{try json(unseal(Data(contentsOf:folder(id).appendingPathComponent("lesson.json")),"meta|\(api)|\(owner)|\(id)"))}
    private static func save(_ id:String,_ item:[String:Any])throws{try write(seal(encoded(item),"meta|\(api)|\(owner)|\(id)"),to:folder(id).appendingPathComponent("lesson.json"))}
    private static func validate(_ item:[String:Any])throws->[String:Any]{guard let token=item["licenseToken"] as? String else{try fail("授权信息缺失")};let data=try claims(token);for field in ["id","deviceHash","sha256","bytes","lessonId","releaseId","assetId","mime"]{guard let signed=data[field],let local=item[field],String(describing:signed)==String(describing:local) else{try fail("课件设备或文件信息不匹配")}};guard try millis(data["expiresAt"] as? String ?? "")>now() else{try fail("离线授权到期，请联网刷新")};return data}
    private static func aad(_ item:[String:Any],_ index:Int)->String{owner+"|"+(item["sha256"] as? String ?? "")+"|"+String(index)}
    fileprivate static func chunk(_ item:[String:Any],_ index:Int)throws->Data{lock.lock();defer{lock.unlock()};_=try validate(item);let id=item["id"] as! String;return try unseal(Data(contentsOf:folder(id).appendingPathComponent("\(index).bin")),aad(item,index))}
    private static func device()throws->String{let url=root.appendingPathComponent("device");if let value=try? String(contentsOf:url,encoding:.utf8){return value};let value=UUID().uuidString.lowercased();try write(Data(value.utf8),to:url);return value}
    private static func result(_ block:()throws->Any?)->String{lock.lock();defer{lock.unlock()};do{return String(data:try encoded(["ok":true,"value":try block() ?? NSNull()]),encoding:.utf8)!}catch{let text=(error as? OfflineIssue)?.text ?? "离线操作未完成，请检查空间、解锁设备后重试";return String(data:try! encoded(["ok":false,"error":text]),encoding:.utf8)!}}
    public static func configure(_ user:String,_ base:String,_ trusted:String)->String{result{
        guard let url=URL(string:base),url.scheme=="https" || url.scheme=="http" && ["localhost","127.0.0.1"].contains(url.host ?? "") else{try fail("离线下载仅支持安全的书院地址")}
        if owner != user || api != base{generation+=1;cancelled=true;network?.cancel();player?.player?.pause();player?.dismiss(animated:false);player=nil;loader=nil;if !owner.isEmpty{try? FileManager.default.removeItem(at:userRoot())};owner=user;api=base}
        keys=(try json(Data(trusted.utf8))) as? [String:String] ?? [:];return ["deviceId":try device()]
    }}
    public static func command(_ action:String,_ raw:String,_ controller:UIViewController?)->String{result{
        let data=try json(Data(raw.utf8))
        switch action {
        case "LIST":let files=try FileManager.default.contentsOfDirectory(at:userRoot(),includingPropertiesForKeys:nil);var items:[[String:Any]]=[];for file in files{if var item=try? metadata(file.lastPathComponent){if !working && item["state"] as? String=="DOWNLOADING"{item["state"]="PAUSED";try? save(file.lastPathComponent,item)};item.removeValue(forKey:"licenseToken");items.append(item)}else{items.append(["id":file.lastPathComponent,"title":"损坏的离线课件","state":"FAILED","error":"请删除后重新下载"])}};return ["items":items,"deviceId":try device()]
        case "START":try start(data);return nil
        case "STATUS":guard let id=data["id"] as? String else{try fail("课件编号缺失")};var item=try metadata(id);item.removeValue(forKey:"licenseToken");return item
        case "PAUSE":if downloadId==data["id"] as? String{cancelled=true;network?.cancel()};return nil
        case "DELETE":guard let id=data["id"] as? String else{try fail("课件编号缺失")};guard !working || id != downloadId else{try fail("请先暂停下载后再删除")};player?.player?.pause();player?.dismiss(animated:false);player=nil;loader=nil;try FileManager.default.removeItem(at:folder(id));return nil
        case "RENEW":guard let id=data["id"] as? String,let token=data["licenseToken"] as? String else{try fail("授权信息缺失")};var item=try metadata(id);let signed=try claims(token);guard signed["id"] as? String==id,signed["sha256"] as? String==item["sha256"] as? String,(signed["version"] as? Int ?? 0)>=(item["version"] as? Int ?? 0) else{try fail("课件版本已变化，请重新下载")};try advance(millis(signed["issuedAt"] as! String));item["licenseToken"]=token;item["version"]=signed["version"];item["expiresAt"]=signed["expiresAt"];try save(id,item);return nil
        case "PLAY":guard let id=data["id"] as? String,let controller=controller else{try fail("页面不可用")};let item=try metadata(id);_=try validate(item);guard item["state"] as? String=="READY" else{try fail("请先完成下载")};let resource=OfflineLoader(item);let asset=AVURLAsset(url:URL(string:"academy-offline://lesson/\(id).mp4")!);asset.resourceLoader.setDelegate(resource,queue:resource.queue);let playerItem=AVPlayerItem(asset:asset),screen=OfflinePlayerController();screen.player=AVPlayer(playerItem:playerItem);loader=resource;player=screen;controller.present(screen,animated:true){screen.player?.play()};return nil
        default:try fail("不支持的离线操作")
        }
    }}
    private static func start(_ input:[String:Any])throws{
        guard !working else{try fail("请等待当前下载停止后再操作")};guard let token=input["licenseToken"] as? String,let bearer=input["accessToken"] as? String,input["deviceId"] as? String == (try device()) else{try fail("下载信息不完整")};let signed=try claims(token);guard let id=signed["id"] as? String,let total=signed["bytes"] as? Int else{try fail("下载信息不完整")};try advance(millis(signed["issuedAt"] as! String));let target=try folder(id);try FileManager.default.createDirectory(at:target,withIntermediateDirectories:true);if let old=try? metadata(id),old["sha256"] as? String != signed["sha256"] as? String{try fail("课件文件已变化")}
        var item=signed;item["licenseToken"]=token;item["title"]=input["title"] as? String ?? "研习课件";item["courseTitle"]=input["courseTitle"] as? String ?? "书院课程";item["state"]="DOWNLOADING";item["receivedBytes"]=0;item["error"]="";try save(id,item);let initial=item,user=owner,endpoint=api,run=generation;working=true;cancelled=false;downloadId=id
        queue.async {
            var row=initial
            do{
                let count=(total+chunkBytes-1)/chunkBytes;var received=0
                for index in 0..<count{
                    lock.lock();let stopped=cancelled || generation != run;lock.unlock();if stopped{throw OfflineIssue(text:"PAUSED")}
                    let file=target.appendingPathComponent("\(index).bin"),expected=min(chunkBytes,total-index*chunkBytes)
                    if let data=try? Data(contentsOf:file),let plain=try? unseal(data,user+"|"+(row["sha256"] as! String)+"|"+String(index)),plain.count==expected{received+=expected}else{
                        var request=URLRequest(url:URL(string:endpoint+"/learning/offline/licenses/\(id)/chunks/\(index)?deviceId="+(try device()))!);request.timeoutInterval=30;request.setValue("Bearer "+bearer,forHTTPHeaderField:"Authorization");request.setValue(token,forHTTPHeaderField:"X-Offline-License");let semaphore=DispatchSemaphore(value:0);let reply=OfflineReply()
                        let session=URLSession(configuration:.ephemeral,delegate:OfflineNetworkDelegate(),delegateQueue:nil)
                        let task=session.dataTask(with:request){body,response,error in reply.body=body;reply.response=response as? HTTPURLResponse;reply.error=error;semaphore.signal()};lock.lock();network=task;lock.unlock();task.resume();semaphore.wait();session.finishTasksAndInvalidate()
                        guard reply.response?.statusCode==200,let body=reply.body,body.count==expected,hash(body)==reply.response?.value(forHTTPHeaderField:"X-Chunk-SHA256") else{if reply.response?.statusCode==401{try fail("登录凭证需刷新，请点击继续下载")};try fail("下载或权限校验中断，请联网后重试")}
                        lock.lock();let changed=cancelled || generation != run;lock.unlock();if changed{throw OfflineIssue(text:"PAUSED")};try write(seal(body,user+"|"+(row["sha256"] as! String)+"|"+String(index)),to:file);received+=body.count
                    }
                    try synchronized{if generation==run{row["receivedBytes"]=received;try save(id,row)}}
                }
                var digest=SHA256();for index in 0..<count{lock.lock();let changed=cancelled || generation != run;lock.unlock();if changed{throw OfflineIssue(text:"PAUSED")};digest.update(data:try unseal(Data(contentsOf:target.appendingPathComponent("\(index).bin")),user+"|"+(row["sha256"] as! String)+"|"+String(index)))};guard digest.finalize().map({String(format:"%02x",$0)}).joined()==row["sha256"] as? String else{try fail("整份课件校验失败，请删除后重新下载")};_=try synchronized{try validate(row)};row["state"]="READY"
            }catch{lock.lock();let stopped=cancelled || generation != run;lock.unlock();row["state"]=stopped ? "PAUSED":"FAILED";row["error"]=stopped ? "":((error as? OfflineIssue)?.text ?? "下载中断，请稍后重试")}
            lock.lock();if generation==run{try? save(id,row)}else{try? FileManager.default.removeItem(at:target)};working=false;network=nil;lock.unlock()
        }
    }
}
private final class OfflineReply:@unchecked Sendable{var body:Data?;var response:HTTPURLResponse?;var error:Error?}
private final class OfflineNetworkDelegate:NSObject,URLSessionTaskDelegate{func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}}
private final class OfflineLoader:NSObject,AVAssetResourceLoaderDelegate{
    let item:[String:Any],queue=DispatchQueue(label:"academy.offline.player");private var cachedIndex = -1,cached=Data()
    init(_ item:[String:Any]){self.item=item}
    func resourceLoader(_ resourceLoader:AVAssetResourceLoader,shouldWaitForLoadingOfRequestedResource request:AVAssetResourceLoadingRequest)->Bool{
        do{try AcademyOffline.playbackAllowed(item);let total=(item["bytes"] as? NSNumber)?.int64Value ?? 0;if let info=request.contentInformationRequest{info.contentType=(item["mime"] as? String)=="audio/mp4" ? "public.mpeg-4-audio":"public.mpeg-4";info.contentLength=total;info.isByteRangeAccessSupported=true};if let data=request.dataRequest{var position=max(data.requestedOffset,data.currentOffset),remaining=data.requestsAllDataToEndOfResource ? total-position:min(Int64(data.requestedLength),total-position);while remaining>0 && !request.isCancelled{let index=Int(position/Int64(AcademyOffline.chunkBytes));if index != cachedIndex{cached=try AcademyOffline.chunk(item,index);cachedIndex=index};let start=Int(position%Int64(AcademyOffline.chunkBytes)),length=min(cached.count-start,Int(min(remaining,Int64(AcademyOffline.chunkBytes))));guard length>0 else{throw OfflineIssue(text:"课件分片不完整")};data.respond(with:cached.subdata(in:start..<start+length));position+=Int64(length);remaining-=Int64(length)}};request.finishLoading();return true}catch{request.finishLoading(with:NSError(domain:"AcademyOffline",code:1,userInfo:[NSLocalizedDescriptionKey:"离线授权或课件不可用，请联网刷新"]));return false}
    }
}

private final class OfflinePlayerController:AVPlayerViewController{override func viewDidDisappear(_ animated:Bool){super.viewDidDisappear(animated);player?.pause();AcademyOffline.closed()}}
