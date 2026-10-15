package io.github.maximbelov.sentrysdk

import io.sentry.Breadcrumb
import android.content.pm.PackageManager
import android.os.Build
import io.sentry.Sentry
import io.sentry.SentryLevel
import io.sentry.android.core.SentryAndroid
import io.sentry.android.core.SentryAndroidOptions
import io.sentry.protocol.User
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject
import java.util.Date

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

    // The severities a page may name, as Sentry spells them.
    private val SENTRY_LEVELS = mapOf(
        "debug" to SentryLevel.DEBUG,
        "info" to SentryLevel.INFO,
        "warning" to SentryLevel.WARNING,
        "error" to SentryLevel.ERROR,
        "fatal" to SentryLevel.FATAL,
    )

    // Breadcrumbs are a trail, not a key, so what the page adds before the SDK is running is kept in order, up to the last
    // MAX_PENDING_BREADCRUMBS, and `start` adds them. A clear drops them, as it would drop the SDK's own.
    private val pendingBreadcrumbs = ArrayList<Breadcrumb>()

    // `crash` takes the process down, so it is refused unless the page said so in an accepted `start`: that it is a device test. It is the
    // page's word and not a lock, so it keeps a stray call from ending the app, not a script that can call `start` itself.
    private var crashAllowed = false

    override fun execute(action: String, args: JSONArray, callbackContext: CallbackContext): Boolean {
        when (action) {
            "start" -> start(args.optJSONObject(0), callbackContext)
            "setUser" -> setUser(args.optJSONObject(0), callbackContext)
            "setTags" -> setTags(args.optJSONObject(0), callbackContext)
            "setContext" -> setContext(args.optString(0), args.optJSONObject(1), callbackContext)
            "addBreadcrumb" -> addBreadcrumb(args.optJSONObject(0), callbackContext)
            "clearBreadcrumbs" -> clearBreadcrumbs(callbackContext)
            "setExtras" -> setExtras(args.optJSONObject(0), callbackContext)
            "close" -> close(callbackContext)
            "isEnabled" -> isEnabled(callbackContext)
            "getDeviceInfo" -> getDeviceInfo(callbackContext)
            "captureMessage" -> captureMessage(args.optString(0), args.optString(1), callbackContext)
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
            SentryAndroid.init(cordova.context) { configure(it, options) }
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
        pendingBreadcrumbs.forEach { Sentry.addBreadcrumb(it) }
        pendingBreadcrumbs.clear()
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

    private fun addBreadcrumb(json: JSONObject?, callbackContext: CallbackContext) {
        if (json == null) {
            callbackContext.error("addBreadcrumb needs an object")
            return
        }
        val breadcrumb = toBreadcrumb(json)
        if (Sentry.isEnabled()) {
            Sentry.addBreadcrumb(breadcrumb)
            callbackContext.success("added")
            return
        }
        pendingBreadcrumbs.add(breadcrumb)
        while (pendingBreadcrumbs.size > MAX_PENDING_BREADCRUMBS) {
            pendingBreadcrumbs.removeAt(0)
        }
        callbackContext.success("queued")
    }

    private fun clearBreadcrumbs(callbackContext: CallbackContext) {
        pendingBreadcrumbs.clear()
        if (Sentry.isEnabled()) {
            Sentry.configureScope { it.clearBreadcrumbs() }
        }
        callbackContext.success("cleared")
    }

    /** The wrapper has mapped `log` and `critical` to `debug` and `fatal`, and settled the types: here a field is read, not checked. */
    private fun toBreadcrumb(json: JSONObject): Breadcrumb {
        val breadcrumb = if (json.has("timestamp")) Breadcrumb(Date((json.optDouble("timestamp") * 1000).toLong())) else Breadcrumb()
        json.optString("type").takeIf { it.isNotEmpty() }?.let { breadcrumb.type = it }
        json.optString("category").takeIf { it.isNotEmpty() }?.let { breadcrumb.category = it }
        json.optString("message").takeIf { it.isNotEmpty() }?.let { breadcrumb.message = it }
        breadcrumb.level = when (json.optString("level")) {
            "fatal" -> SentryLevel.FATAL
            "error" -> SentryLevel.ERROR
            "warning" -> SentryLevel.WARNING
            "info" -> SentryLevel.INFO
            "debug" -> SentryLevel.DEBUG
            else -> SentryLevel.INFO
        }
        // A breadcrumb keeps its data in a map that takes no null, so a null value is a key that is not there.
        json.optJSONObject("data")?.let { data -> data.keys().forEach { key -> fromJson(data.opt(key))?.let { breadcrumb.setData(key, it) } } }
        return breadcrumb
    }

    /** The wrapper has made every value text, or null for a removal. */
    private fun setExtras(extras: JSONObject?, callbackContext: CallbackContext) {
        if (extras == null) {
            callbackContext.error("setExtras needs an object")
            return
        }
        var applied = true
        for (key in extras.keys()) {
            val value = if (extras.isNull(key)) null else extras.getString(key)
            applied = applyOrKeep("extra:$key") { if (value == null) Sentry.removeExtra(key) else Sentry.setExtra(key, value) } && applied
        }
        callbackContext.success(if (applied) "set" else "queued")
    }

    /**
     * `Sentry.close` flushes, which can take as long as the SDK's shutdown timeout, so it does not run on the thread Cordova called
     * the plugin on. What the page set while the SDK was down stays kept for the next `start`, and `allowCrash` does not: it was the
     * word of the `start` that is over.
     */
    private fun close(callbackContext: CallbackContext) {
        cordova.threadPool.execute {
            if (!Sentry.isEnabled()) {
                callbackContext.success("not running")
                return@execute
            }
            Sentry.close()
            crashAllowed = false
            callbackContext.success("closed")
        }
    }

    private fun isEnabled(callbackContext: CallbackContext) {
        callbackContext.sendPluginResult(PluginResult(PluginResult.Status.OK, Sentry.isEnabled()))
    }

    /** What the system says, which the web view's user agent does not: Chrome freezes the Android version and the model in it. */
    @Suppress("DEPRECATION")
    private fun getDeviceInfo(callbackContext: CallbackContext) {
        val context = cordova.context
        val packages = context.packageManager
        val info =
            if (Build.VERSION.SDK_INT >= 33) packages.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
            else packages.getPackageInfo(context.packageName, 0)
        val build = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        callbackContext.success(deviceInfo(Build.VERSION.RELEASE, Build.MODEL, info.versionName, build))
    }

    /**
     * Sends a message event. Not queued: a message needs the SDK running, so a call before `start` is answered with an error,
     * and the page knows the message was not sent.
     */
    private fun captureMessage(message: String, level: String, callbackContext: CallbackContext) {
        if (message.isEmpty()) {
            callbackContext.error("captureMessage needs a message")
            return
        }
        val sentryLevel = SENTRY_LEVELS[level]
        if (sentryLevel == null) {
            callbackContext.error("captureMessage: the level has to be debug, info, warning, error or fatal")
            return
        }
        if (!Sentry.isEnabled()) {
            callbackContext.error("captureMessage needs a running SDK: start has to be answered first")
            return
        }
        Sentry.captureMessage(message, sentryLevel)
        callbackContext.success("sent")
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

    private companion object {
        /** The SDK's own default for how many breadcrumbs a scope holds. */
        const val MAX_PENDING_BREADCRUMBS = 100
    }
}

/**
 * The options the page passes, applied to the SDK's. On its own so the mapping can be tested without a running SDK. An option the page
 * does not give is left to the SDK's own default, except where the README says the plugin's differs.
 *
 * `sendDefaultPii` is deprecated in sentry-android 8.61.0 in favour of its `DataCollection` options, which are finer. It still works, and
 * it is the one switch sentry-cocoa has too, so the page gets one option on both platforms; hence the suppressed warning.
 */
@Suppress("DEPRECATION")
internal fun configure(sentryOptions: SentryAndroidOptions, options: JSONObject) {
    sentryOptions.dsn = options.optString("dsn")
    options.optString("release").takeIf { it.isNotEmpty() }?.let { sentryOptions.release = it }
    options.optString("environment").takeIf { it.isNotEmpty() }?.let { sentryOptions.environment = it }
    options.optString("dist").takeIf { it.isNotEmpty() }?.let { sentryOptions.dist = it }
    sentryOptions.isEnableAutoSessionTracking = options.optBoolean("enableAutoSessionTracking", true)
    // What reports a crash: the handler for an uncaught exception, the ANR watch and the NDK integration. One option turns the three off, and
    // it takes `enableAnrTracking` with it, which is how a page that wants no crash handling gets none.
    val crashHandling = options.optBoolean("enableNativeCrashHandling", true)
    sentryOptions.isEnableUncaughtExceptionHandler = crashHandling
    sentryOptions.isAnrEnabled = crashHandling && options.optBoolean("enableAnrTracking", true)
    sentryOptions.isEnableNdk = crashHandling
    if (options.has("enableNdkScopeSync")) sentryOptions.isEnableScopeSync = options.optBoolean("enableNdkScopeSync")
    if (options.has("debug")) sentryOptions.isDebug = options.optBoolean("debug")
    if (options.has("sendDefaultPii")) sentryOptions.isSendDefaultPii = options.optBoolean("sendDefaultPii")
    if (options.has("attachStacktrace")) sentryOptions.isAttachStacktrace = options.optBoolean("attachStacktrace")
    if (options.has("attachThreads")) sentryOptions.isAttachThreads = options.optBoolean("attachThreads")
    if (options.has("maxBreadcrumbs")) sentryOptions.maxBreadcrumbs = options.optInt("maxBreadcrumbs")
    if (options.has("sampleRate")) sentryOptions.sampleRate = options.optDouble("sampleRate")
    if (options.has("sessionTrackingIntervalMillis")) sentryOptions.sessionTrackingIntervalMillis = options.optLong("sessionTrackingIntervalMillis")
}

/** The answer of `getDeviceInfo`, from what the system gave. On its own so it can be tested with values the test device does not have. */
internal fun deviceInfo(release: String?, model: String?, versionName: String?, versionCode: Long): JSONObject =
    JSONObject()
        .put("osName", "Android")
        .put("osVersion", release.orEmpty())
        .put("deviceModel", model.orEmpty())
        .put("appRelease", versionName.orEmpty())
        .put("appBuild", versionCode.toString())
