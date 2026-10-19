import Foundation
import Security

public class AcademySecureStore {
    private static let service = (Bundle.main.bundleIdentifier ?? "cn.daoxue.academy") + ".secure.v1"
    private static func query(_ key: String) -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                kSecAttrAccount as String: key, kSecAttrSynchronizable as String: false]
    }
    private static func result(_ status: OSStatus, _ value: String? = nil) -> String {
        let data: [String: Any] = ["ok": status == errSecSuccess || status == errSecItemNotFound, "value": value as Any? ?? NSNull()]
        return String(data: try! JSONSerialization.data(withJSONObject: data), encoding: .utf8)!
    }
    public static func read(_ key: String) -> String {
        var request = query(key)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecSuccess {
            guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else { return "{\"ok\":false}" }
            return result(status, value)
        }
        return result(status)
    }
    public static func write(_ key: String, _ value: String) -> String {
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query(key) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query(key).merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        return result(status)
    }
    public static func remove(_ key: String) -> String { return result(SecItemDelete(query(key) as CFDictionary)) }
}
