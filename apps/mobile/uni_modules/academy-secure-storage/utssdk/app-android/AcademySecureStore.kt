package uts.sdk.modules.academySecureStorage

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import io.dcloud.uts.UTSAndroid
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object AcademySecureStore {
    private const val alias = "academy.secure.v1"
    private fun file(key: String): AtomicFile {
        val context = UTSAndroid.getAppContext() ?: error("Context unavailable")
        val dir = File(context.noBackupFilesDir, "academy-secure").apply { mkdirs() }
        val name = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        return AtomicFile(File(dir, name))
    }
    private fun secret(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }
    private fun result(action: () -> String?): String = try {
        JSONObject().put("ok", true).put("value", action() ?: JSONObject.NULL).toString()
    } catch (_: Exception) { "{\"ok\":false}" }
    @Synchronized fun read(key: String): String = result {
        val bytes = try { file(key).readFully() } catch (_: FileNotFoundException) { return@result null }
        require(bytes.size >= 29 && bytes[0].toInt() == 1)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        cipher.updateAAD(key.toByteArray(Charsets.UTF_8))
        String(cipher.doFinal(bytes.copyOfRange(13, bytes.size)), Charsets.UTF_8)
    }
    @Synchronized fun write(key: String, value: String): String = result {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secret())
        cipher.updateAAD(key.toByteArray(Charsets.UTF_8))
        val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val target = file(key)
        val stream = target.startWrite()
        try { stream.write(bytes); target.finishWrite(stream) }
        catch (error: Exception) { target.failWrite(stream); throw error }
        null
    }
    @Synchronized fun remove(key: String): String = result {
        val target = file(key)
        target.delete()
        check(!target.baseFile.exists())
        null
    }
}
