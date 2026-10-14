package io.github.maximbelov.sentrysdk

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
class SentrySdk : CordovaPlugin() {

    // Whether the SDK is running is the SDK's to say: it is one per process, and a plugin instance is one per web view, so an
    // Activity that Android recreates brings a new instance to an SDK that is still up. What the plugin does remember is what the
    // page set before the SDK was running: the last change of each key, applied by `start`.
    private val pending = LinkedHashMap<String, () -> Unit>()

    // `crash` takes the process down, so it is refused unless the page said so in an accepted `start`: that it is a device test. It is the
    // page's word and not a lock, so it keeps a stray call from ending the app, not a script that can call `start` itself.
    private var crashAllowed = false

    override fun execute(action: String, args: JSONArray, callbackContext: CallbackContext): Boolean {
        when (action) {
            "start" -> start(args.optJSONObject(0), callbackContext)
            "setUser" -> setUser(args.optJSONObject(0), callbackContext)
            "setTags" -> setTags(args.optJSONObject(0), callbackContext)
            "setContext" -> setContext(args.optString(0), args.optJSONObject(1), callbackContext)
            "crash" -> crash(callbackContext)
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
        val allowCrash = options.optBoolean("allowCrash", false)
        // Started by an earlier instance of this plugin, or by the app itself: either way it is running, and its options are its own.
        if (Sentry.isEnabled()) {
            crashAllowed = allowCrash
            callbackContext.success("already started")
            return
        }
        try {
            SentryAndroid.init(cordova.context) { sentryOptions ->
                sentryOptions.dsn = dsn
                options.optString("release").takeIf { it.isNotEmpty() }?.let { sentryOptions.release = it }
                options.optString("environment").takeIf { it.isNotEmpty() }?.let { sentryOptions.environment = it }
                options.optString("dist").takeIf { it.isNotEmpty() }?.let { sentryOptions.dist = it }
                sentryOptions.isEnableAutoSessionTracking = options.optBoolean("enableAutoSessionTracking", true)
                sentryOptions.isAnrEnabled = options.optBoolean("enableAnrTracking", true)
            }
        } catch (error: IllegalArgumentException) {
            // A dsn that does not parse: the SDK refuses to start, and so does the plugin, so the page can try again with a good one.
            callbackContext.error("start was refused: ${error.message}")
            return
        }
        if (!Sentry.isEnabled()) {
            callbackContext.error("start was refused: the SDK did not start")
            return
        }
        pending.values.forEach { it() }
        pending.clear()
        crashAllowed = allowCrash
        callbackContext.success("started")
    }

    /**
     * Runs a change of the scope now, or, while the SDK is not running, keeps the last change of its key for `start`: a call
     * before the SDK is up changes a scope that is thrown away when it starts. Says which it did.
     */
    private fun applyOrKeep(key: String, change: () -> Unit): Boolean {
        if (Sentry.isEnabled()) {
            change()
            return true
        }
        pending[key] = change
        return false
    }

    private fun setUser(user: JSONObject?, callbackContext: CallbackContext) {
        val applied = applyOrKeep("user") {
            Sentry.setUser(
                user?.let {
                    User().apply {
                        it.optString("id").takeIf { value -> value.isNotEmpty() }?.let { value -> id = value }
                        it.optString("email").takeIf { value -> value.isNotEmpty() }?.let { value -> email = value }
                        it.optString("username").takeIf { value -> value.isNotEmpty() }?.let { value -> username = value }
                    }
                },
            )
        }
        callbackContext.success(if (!applied) "queued" else if (user == null) "cleared" else "set")
    }

    private fun setTags(tags: JSONObject?, callbackContext: CallbackContext) {
        if (tags == null) {
            callbackContext.error("setTags needs an object")
            return
        }
        var applied = true
        for (key in tags.keys()) {
            val value = if (tags.isNull(key)) null else tags.get(key).toString()
            applied = applyOrKeep("tag:$key") { if (value == null) Sentry.removeTag(key) else Sentry.setTag(key, value) } && applied
        }
        callbackContext.success(if (applied) "set" else "queued")
    }

    private fun setContext(key: String, value: JSONObject?, callbackContext: CallbackContext) {
        if (key.isEmpty()) {
            callbackContext.error("setContext needs a key")
            return
        }
        val applied = applyOrKeep("context:$key") {
            Sentry.configureScope { scope ->
                if (value == null) scope.removeContexts(key) else scope.setContexts(key, toMap(value))
            }
        }
        callbackContext.success(if (applied) "set" else "queued")
    }

    /** For a device probe: thrown on the main thread so the process really goes down, as a user's crash would. */
    private fun crash(callbackContext: CallbackContext) {
        if (!crashAllowed) {
            callbackContext.error("crash is refused: it is for a device test, and start has to be given allowCrash: true")
            return
        }
        cordova.activity.runOnUiThread { throw RuntimeException("SentrySdk: test crash") }
    }

    private fun toMap(json: JSONObject): Map<String, Any?> =
        json.keys().asSequence().associateWith { key -> fromJson(json.opt(key)) }

    private fun toList(json: JSONArray): List<Any?> = (0 until json.length()).map { fromJson(json.opt(it)) }

    // Sentry serialises what it is given; a JSONObject or JSONArray left inside a map reaches it as an opaque object.
    private fun fromJson(value: Any?): Any? =
        when (value) {
            is JSONObject -> toMap(value)
            is JSONArray -> toList(value)
            JSONObject.NULL, null -> null
            else -> value
        }
}
