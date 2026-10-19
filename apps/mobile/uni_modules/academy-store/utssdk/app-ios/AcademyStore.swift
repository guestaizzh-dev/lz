import Foundation
import StoreKit

public class AcademyStore {
    public static func command(_ action:String,_ payload:String)->String {
        guard #available(iOS 15.0,*) else{return "{\"ok\":false,\"error\":\"Apple内购需要iOS 15或以上系统\"}"}
        return AcademyStore2.command(action,payload)
    }
}

@available(iOS 15.0,*)
private class AcademyStore2 {
    private static let lock=NSLock()
    private static var operations:[String:[String:Any]]=[:]
    private static var transactions:[String:StoreKit.Transaction]=[:]
    private static var purchasing=false
    private static func encode(_ value:[String:Any])->String{String(data:(try? JSONSerialization.data(withJSONObject:value)) ?? Data(),encoding:.utf8) ?? "{}"}
    private static func update(_ id:String,_ value:[String:Any]){lock.lock();defer{lock.unlock()};operations[id]=value}
    private static func purchaseEnded(){lock.lock();defer{lock.unlock()};purchasing=false}
    static func command(_ action:String,_ raw:String)->String {
        guard let data=raw.data(using:.utf8),let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let id=value["operationId"] as? String,UUID(uuidString:id) != nil else{return encode(["ok":false,"error":"购买请求标识无效"])}
        lock.lock()
        if action=="STATUS"{let result=operations[id] ?? ["state":"ERROR","error":"购买状态不存在，请恢复未完成交易"];lock.unlock();return encode(["ok":true,"value":result])}
        if action=="CLEAR"{operations.removeValue(forKey:id);lock.unlock();return encode(["ok":true])}
        if operations[id] != nil{lock.unlock();return encode(["ok":true])}
        if !["PRODUCTS","PURCHASE","RESTORE","FINISH"].contains(action){lock.unlock();return encode(["ok":false,"error":"购买操作无效"])}
        if action=="PURCHASE" && purchasing{lock.unlock();return encode(["ok":false,"error":"请先完成当前购买或恢复原交易"])}
        if action=="PURCHASE"{purchasing=true}
        operations[id] = ["state":"RUNNING"];lock.unlock()
        Task { @MainActor in
            defer{if action=="PURCHASE"{purchaseEnded()}}
            do{
                switch action {
                case "PRODUCTS":
                    let ids=value["productIds"] as? [String] ?? []
                    guard !ids.isEmpty,ids.count<=20 else{throw StoreIssue.invalid}
                    let products=try await Product.products(for:ids)
                    update(id,["state":"DONE","products":products.map{["id":$0.id,"displayPrice":$0.displayPrice,"priceMinor":NSDecimalNumber(decimal:$0.price*100).stringValue,"currency":$0.priceFormatStyle.currencyCode] as [String:Any]}])
                case "PURCHASE":
                    guard let productId=value["productId"] as? String,let token=value["appAccountToken"] as? String,let account=UUID(uuidString:token),let expected=value["priceMinor"] as? String else{throw StoreIssue.invalid}
                    let products=try await Product.products(for:[productId])
                    guard let product=products.first,product.type == .consumable,product.priceFormatStyle.currencyCode=="CNY",NSDecimalNumber(decimal:product.price*100).stringValue==expected else{throw StoreIssue.price}
                    switch try await product.purchase(options:[.appAccountToken(account)]){
                    case .success(let result):
                        guard case .verified(let transaction)=result else{throw StoreIssue.unverified}
                        transactions[String(transaction.id)]=transaction
                        update(id,["state":"DONE","transactions":[["id":String(transaction.id),"signedTransaction":result.jwsRepresentation]]])
                    case .pending:update(id,["state":"PENDING"])
                    case .userCancelled:update(id,["state":"CANCELLED"])
                    @unknown default:throw StoreIssue.invalid
                    }
                case "RESTORE":
                    var results:[[String:String]]=[]
                    for await result in StoreKit.Transaction.unfinished {
                        if case .verified(let transaction)=result{transactions[String(transaction.id)]=transaction;results.append(["id":String(transaction.id),"signedTransaction":result.jwsRepresentation])}
                    }
                    update(id,["state":"DONE","transactions":results])
                case "FINISH":
                    guard let transactionId=value["transactionId"] as? String,let transaction=transactions[transactionId] else{throw StoreIssue.invalid}
                    // The caller invokes this only after the server acknowledges the signed transaction.
                    await transaction.finish();transactions.removeValue(forKey:transactionId);update(id,["state":"DONE"])
                default:throw StoreIssue.invalid
                }
            }catch{let issue=error as? StoreIssue;update(id,["state":"ERROR","error":issue == .price ? "App Store价格已变化或非人民币，请刷新后确认":issue == .unverified ? "Apple交易尚未通过设备验证，请恢复购买或联系书院":"Apple操作未完成，请检查网络并恢复未完成交易"])}
        }
        return encode(["ok":true])
    }
    private enum StoreIssue:Error,Equatable {case invalid,price,unverified}
}
