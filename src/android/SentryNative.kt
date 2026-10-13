package io.github.maximbelov.sentry

import io.sentry.Sentry
import io.sentry.android.core.SentryAndroid
import io.sentry.protocol.User
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.json.JSONArray
import org.json.JSONObject

/**
 * The native Sentry SDK, started and kept in sync from the page. Only the public API of
 * sentry-android: `SentryAndroid.init`, `Sentry.setUser`, `setTag`, `configureScope`. No transport, no
 * envelope bridge -- the JS SDK sends its own events, this only owns what the page cannot see: a native
 * crash, an ANR, an application exit.
 */
class SentryNative : CordovaPlugin() {

    private var started = false

    override fun execute(action: String, args: JSONArray, callbackContext: CallbackContext): Boolean {
        when (action) {
            "start" -> start(args.optJSONObject(0), callbackContext)
            "setUser" -> setUser(args.optJSONObject(0), callbackContext)
            "setTags" -> setTags(args.optJSONObject(0), callbackContext)
            "setContext" -> setContext(args.optString(0), args.optJSONObject(1), callbackContext)
            "crash" -> crash()
            else -> return false
        }
        return true
    }

    private fun start(optionsOrNull: JSONObject?, callbackContext: CallbackContext) {
        val options = optionsOrNull ?: JSONObject()
        val dsn = options.optString("dsn")
        if (dsn.isEmpty()) {
            callbackContext.error("start needs an options object with a dsn")
            return
        }
        if (started) {
            callbackContext.success("already started")
            return
        }
        SentryAndroid.init(cordova.context) { sentryOptions ->
            sentryOptions.dsn = dsn
            options.optString("release").takeIf { it.isNotEmpty() }?.let { sentryOptions.release = it }
            options.optString("environment").takeIf { it.isNotEmpty() }?.let { sentryOptions.environment = it }
            options.optString("dist").takeIf { it.isNotEmpty() }?.let { sentryOptions.dist = it }
            sentryOptions.isEnableAutoSessionTracking = options.optBoolean("enableAutoSessionTracking", true)
            sentryOptions.isAnrEnabled = options.optBoolean("enableAnrTracking", true)
        }
        started = true
        callbackContext.success("started")
    }

    private fun setUser(user: JSONObject?, callbackContext: CallbackContext) {
        if (user == null) {
            Sentry.setUser(null)
            callbackContext.success("cleared")
            return
        }
        Sentry.setUser(User().apply {
            user.optString("id").takeIf { it.isNotEmpty() }?.let { id = it }
            user.optString("email").takeIf { it.isNotEmpty() }?.let { email = it }
            user.optString("username").takeIf { it.isNotEmpty() }?.let { username = it }
        })
        callbackContext.success("set")
    }

    private fun setTags(tags: JSONObject?, callbackContext: CallbackContext) {
        if (tags == null) {
            callbackContext.error("setTags needs an object")
            return
        }
        for (key in tags.keys()) {
            if (tags.isNull(key)) Sentry.removeTag(key) else Sentry.setTag(key, tags.get(key).toString())
        }
        callbackContext.success("set")
    }

    private fun setContext(key: String, value: JSONObject?, callbackContext: CallbackContext) {
        if (key.isEmpty()) {
            callbackContext.error("setContext needs a key")
            return
        }
        Sentry.configureScope { scope ->
            if (value == null) scope.removeContexts(key) else scope.setContexts(key, toMap(value))
        }
        callbackContext.success("set")
    }

    /** For a device probe: thrown on the main thread so the process really goes down, as a user's crash would. */
    private fun crash() {
        cordova.activity.runOnUiThread { throw RuntimeException("SentryNative: test crash") }
    }

    private fun toMap(json: JSONObject): Map<String, Any?> =
        json.keys().asSequence().associateWith { key ->
            when (val value = json.opt(key)) {
                is JSONObject -> toMap(value)
                is JSONArray -> (0 until value.length()).map { value.opt(it) }
                JSONObject.NULL -> null
                else -> value
            }
        }
}
