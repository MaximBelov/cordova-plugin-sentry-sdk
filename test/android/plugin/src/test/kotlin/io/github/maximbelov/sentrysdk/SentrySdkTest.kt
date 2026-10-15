package io.github.maximbelov.sentrysdk

import androidx.appcompat.app.AppCompatActivity
import io.sentry.Breadcrumb
import io.sentry.Sentry
import io.sentry.SentryLevel
import io.sentry.android.core.SentryAndroid
import io.sentry.android.core.SentryAndroidOptions
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaInterfaceImpl
import org.apache.cordova.CordovaPreferences
import org.apache.cordova.CordovaWebView
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.mock
import org.mockito.Mockito.timeout
import org.mockito.Mockito.verify
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * What the plugin answers JavaScript, and what it puts on the native scope, with sentry-android started for real against a DSN
 * whose host answers nothing. No emulator: Robolectric stands in for Android.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SentrySdkTest {
    private lateinit var activity: AppCompatActivity
    private lateinit var webView: CordovaWebView
    private lateinit var plugin: SentrySdk
    private var calls = 0

    @Before
    fun setUp() {
        // cordova-android's CordovaInterfaceImpl takes an AppCompatActivity, which needs an AppCompat theme to be created.
        val controller = Robolectric.buildActivity(AppCompatActivity::class.java)
        controller.get().setTheme(androidx.appcompat.R.style.Theme_AppCompat)
        activity = controller.setup().get()
        webView = mock(CordovaWebView::class.java)
        plugin = newPlugin()
    }

    /** A plugin instance the way Cordova makes one per web view, handing it its interface and web view. */
    private fun newPlugin(): SentrySdk =
        SentrySdk().also { it.privateInitialize("SentrySdk", CordovaInterfaceImpl(activity), webView, CordovaPreferences()) }

    @After
    fun tearDown() {
        Sentry.close()
    }

    /** Runs an action the way Cordova does and returns what the plugin sent to JavaScript. */
    private fun run(action: String, vararg args: Any?): PluginResult = runOn(plugin, action, *args)

    private fun runOn(target: SentrySdk, action: String, vararg args: Any?): PluginResult {
        val id = "cb" + (++calls)
        val callback = CallbackContext(id, webView)
        val json = JSONArray()
        args.forEach { json.put(it ?: JSONObject.NULL) }
        assertTrue("the action is known: $action", target.execute(action, json, callback))
        val sent = ArgumentCaptor.forClass(PluginResult::class.java)
        // `close` answers from a thread of Cordova's pool, so the answer is waited for; the others have answered by now.
        verify(webView, timeout(10_000)).sendPluginResult(sent.capture(), org.mockito.ArgumentMatchers.eq(id))
        return sent.value
    }

    private fun json(vararg pairs: Pair<String, Any?>) = JSONObject().apply { pairs.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) } }

    /** The scope's breadcrumbs that these tests added (their category starts with `t.`); the SDK adds some of its own at start. */
    private fun crumbs(): List<Breadcrumb> {
        var seen: List<Breadcrumb> = emptyList()
        Sentry.configureScope { seen = it.breadcrumbs.toList() }
        return seen.filter { it.category?.startsWith("t.") == true }
    }

    @Test
    fun `an unknown action is not handled`() {
        assertFalse(plugin.execute("nope", JSONArray(), CallbackContext("x", webView)))
    }

    /** The SDK's options as `start` would leave them for these page options. */
    private fun configured(vararg pairs: Pair<String, Any?>): SentryAndroidOptions =
        SentryAndroidOptions().also { configure(it, json("dsn" to DSN, *pairs)) }

    @Suppress("DEPRECATION")
    @Test
    fun `start options the page does not give leave the SDK's own defaults`() {
        val fresh = SentryAndroidOptions()
        val options = configured()
        assertEquals(fresh.isDebug, options.isDebug)
        assertEquals(fresh.isSendDefaultPii, options.isSendDefaultPii)
        assertEquals(fresh.maxBreadcrumbs, options.maxBreadcrumbs)
        assertEquals(fresh.sampleRate, options.sampleRate)
        assertEquals(fresh.isAttachStacktrace, options.isAttachStacktrace)
        assertEquals(fresh.isAttachThreads, options.isAttachThreads)
        assertEquals(fresh.sessionTrackingIntervalMillis, options.sessionTrackingIntervalMillis)
        assertEquals(fresh.isEnableScopeSync, options.isEnableScopeSync)
        assertEquals(fresh.isEnableUncaughtExceptionHandler, options.isEnableUncaughtExceptionHandler)
        assertEquals(fresh.isAnrEnabled, options.isAnrEnabled)
        assertEquals(fresh.isEnableNdk, options.isEnableNdk)
        assertEquals(DSN, options.dsn)
    }

    @Test
    fun `start options release, environment and dist reach the SDK, and an empty one is left out`() {
        val options = configured("release" to "tests@0.1.0", "environment" to "test", "dist" to "7")
        assertEquals("tests@0.1.0", options.release)
        assertEquals("test", options.environment)
        assertEquals("7", options.dist)
        assertEquals(SentryAndroidOptions().release, configured("release" to "").release)
    }

    @Test
    fun `debug reaches the SDK`() {
        assertTrue(configured("debug" to true).isDebug)
        assertFalse(configured("debug" to false).isDebug)
    }

    @Suppress("DEPRECATION")
    @Test
    fun `sendDefaultPii reaches the SDK`() {
        assertTrue(configured("sendDefaultPii" to true).isSendDefaultPii)
        assertFalse(configured("sendDefaultPii" to false).isSendDefaultPii)
    }

    @Test
    fun `attachStacktrace reaches the SDK`() {
        assertFalse(configured("attachStacktrace" to false).isAttachStacktrace)
        assertTrue(configured("attachStacktrace" to true).isAttachStacktrace)
    }

    @Test
    fun `attachThreads reaches the SDK`() {
        assertTrue(configured("attachThreads" to true).isAttachThreads)
        assertFalse(configured("attachThreads" to false).isAttachThreads)
    }

    @Test
    fun `maxBreadcrumbs reaches the SDK`() {
        assertEquals(7, configured("maxBreadcrumbs" to 7).maxBreadcrumbs)
        assertEquals(0, configured("maxBreadcrumbs" to 0).maxBreadcrumbs)
    }

    @Test
    fun `sampleRate reaches the SDK`() {
        assertEquals(0.25, configured("sampleRate" to 0.25).sampleRate!!, 0.0)
        assertEquals(0.0, configured("sampleRate" to 0).sampleRate!!, 0.0)
        assertEquals(1.0, configured("sampleRate" to 1).sampleRate!!, 0.0)
    }

    @Test
    fun `sessionTrackingIntervalMillis reaches the SDK`() {
        assertEquals(60000L, configured("sessionTrackingIntervalMillis" to 60000).sessionTrackingIntervalMillis)
        assertEquals(0L, configured("sessionTrackingIntervalMillis" to 0).sessionTrackingIntervalMillis)
    }

    @Test
    fun `enableNdkScopeSync reaches the SDK`() {
        assertFalse(configured("enableNdkScopeSync" to false).isEnableScopeSync)
        assertTrue(configured("enableNdkScopeSync" to true).isEnableScopeSync)
    }

    @Test
    fun `enableNativeCrashHandling false turns off the uncaught exception handler, the ANR watch and the NDK, and takes enableAnrTracking with it`() {
        val off = configured("enableNativeCrashHandling" to false, "enableAnrTracking" to true)
        assertFalse(off.isEnableUncaughtExceptionHandler)
        assertFalse(off.isAnrEnabled)
        assertFalse(off.isEnableNdk)
        val on = configured("enableNativeCrashHandling" to true)
        assertTrue(on.isEnableUncaughtExceptionHandler)
        assertTrue(on.isAnrEnabled)
        assertTrue(on.isEnableNdk)
    }

    @Test
    fun `enableAnrTracking and enableAutoSessionTracking reach the SDK on their own`() {
        assertFalse(configured("enableAnrTracking" to false).isAnrEnabled)
        assertTrue(configured("enableAnrTracking" to false).isEnableUncaughtExceptionHandler)
        assertFalse(configured("enableAutoSessionTracking" to false).isEnableAutoSessionTracking)
        assertTrue(configured().isEnableAutoSessionTracking)
    }

    @Test
    fun `start without a dsn is refused`() {
        val result = run("start", json("dsn" to ""))
        assertEquals(PluginResult.Status.ERROR.ordinal, result.status)
        assertTrue(result.message.contains("dsn"))
    }

    @Test
    fun `start starts the SDK with the release and environment, and a second start changes nothing`() {
        val first = run("start", json("dsn" to DSN, "release" to "tests@0.1.0", "environment" to "test"))
        assertEquals(PluginResult.Status.OK.ordinal, first.status)
        assertEquals("started", first.strMessage)
        assertTrue(Sentry.isEnabled())
        assertEquals("tests@0.1.0", Sentry.getCurrentScopes().options.release)
        assertEquals("test", Sentry.getCurrentScopes().options.environment)

        val second = run("start", json("dsn" to "https://other@127.0.0.1:9/2", "release" to "other"))
        assertEquals("already started", second.strMessage)
        assertEquals("tests@0.1.0", Sentry.getCurrentScopes().options.release)
    }

    @Test
    fun `start with a dsn that does not parse is refused and the SDK stays off, so a good one can follow`() {
        val refused = run("start", json("dsn" to "not a dsn"))
        assertEquals(PluginResult.Status.ERROR.ordinal, refused.status)
        assertTrue(refused.message.contains("start was refused"))
        assertFalse(Sentry.isEnabled())

        assertEquals("started", run("start", json("dsn" to DSN)).strMessage)
        assertTrue(Sentry.isEnabled())
    }

    @Test
    fun `scope calls before start are kept and answered queued, and start applies the last change of each key`() {
        assertEquals("queued", run("setUser", json("id" to "1")).strMessage)
        assertEquals("queued", run("setUser", json("id" to "42", "email" to "user@example.com")).strMessage)
        assertEquals("queued", run("setTags", json("region" to "IE", "gone" to "soon", "tier" to 1)).strMessage)
        assertEquals("queued", run("setTags", json("gone" to null, "tier" to 2)).strMessage)
        assertEquals("queued", run("setContext", "account", json("animals" to 7)).strMessage)
        assertEquals("queued", run("setContext", "account", json("animals" to 120)).strMessage)
        assertEquals("queued", run("setContext", "farm", json("region" to "IE")).strMessage)
        assertEquals("queued", run("setContext", "farm", null).strMessage)
        assertFalse("nothing started the SDK", Sentry.isEnabled())

        assertEquals("started", run("start", json("dsn" to DSN)).strMessage)

        var user: io.sentry.protocol.User? = null
        var tags: Map<String, String> = emptyMap()
        var contexts: io.sentry.protocol.Contexts? = null
        Sentry.configureScope {
            user = it.user
            tags = it.tags
            contexts = it.contexts
        }
        assertEquals("the last user wins", "42", user?.id)
        assertEquals("user@example.com", user?.email)
        assertEquals("IE", tags["region"])
        assertEquals("the last value of a tag wins", "2", tags["tier"])
        assertFalse("a tag removed before start is not there", tags.containsKey("gone"))
        assertEquals(120, (contexts!!["account"] as Map<*, *>)["animals"])
        assertNull("a context removed before start is not there", contexts!!["farm"])

        // what was kept is applied once: a later change is the page's own, not a replay
        assertEquals("set", run("setTags", json("tier" to 3)).strMessage)
        Sentry.configureScope { tags = it.tags }
        assertEquals("3", tags["tier"])
    }

    @Test
    fun `a user cleared before start stays cleared`() {
        run("setUser", json("id" to "42"))
        assertEquals("queued", run("setUser", null).strMessage)
        run("start", json("dsn" to DSN))
        var user: io.sentry.protocol.User? = null
        Sentry.configureScope { user = it.user }
        assertNull(user)
    }

    @Test
    fun `a second plugin instance finds the SDK running, as after an Activity is recreated, and works on it`() {
        run("start", json("dsn" to DSN, "release" to "tests@0.1.0"))

        val recreated = newPlugin()
        assertEquals("already started", runOn(recreated, "start", json("dsn" to DSN, "release" to "other")).strMessage)
        assertEquals("tests@0.1.0", Sentry.getCurrentScopes().options.release)
        assertEquals("a scope call is applied, not queued", "set", runOn(recreated, "setTags", json("from" to "second")).strMessage)
        var tags: Map<String, String> = emptyMap()
        Sentry.configureScope { tags = it.tags }
        assertEquals("second", tags["from"])
    }

    @Test
    fun `an SDK the app started itself counts as started, and its options stay its own`() {
        SentryAndroid.init(activity) {
            it.dsn = DSN
            it.release = "app@1"
        }
        assertEquals("already started", run("start", json("dsn" to DSN, "release" to "tests@0.1.0")).strMessage)
        assertEquals("app@1", Sentry.getCurrentScopes().options.release)
    }

    @Test
    fun `setUser puts the user on the scope and null clears it`() {
        run("start", json("dsn" to DSN))
        assertEquals("set", run("setUser", json("id" to "42", "email" to "user@example.com", "username" to "tester")).strMessage)
        var seen: io.sentry.protocol.User? = null
        Sentry.configureScope { seen = it.user }
        assertEquals("42", seen?.id)
        assertEquals("user@example.com", seen?.email)
        assertEquals("tester", seen?.username)

        assertEquals("cleared", run("setUser", null).strMessage)
        Sentry.configureScope { seen = it.user }
        assertNull(seen)
    }

    @Test
    fun `setTags sets each tag as text and removes the null ones`() {
        run("start", json("dsn" to DSN))
        run("setTags", json("gone" to "soon"))
        assertEquals("set", run("setTags", json("account.region" to "IE", "premium" to true, "animals" to 12, "gone" to null)).strMessage)
        var tags: Map<String, String> = emptyMap()
        Sentry.configureScope { tags = it.tags }
        assertEquals("IE", tags["account.region"])
        assertEquals("true", tags["premium"])
        assertEquals("12", tags["animals"])
        assertFalse(tags.containsKey("gone"))
    }

    @Test
    fun `setTags without an object is refused`() {
        val result = run("setTags", null)
        assertEquals(PluginResult.Status.ERROR.ordinal, result.status)
    }

    @Test
    fun `setContext puts a named object on the scope, nested, and null removes it`() {
        run("start", json("dsn" to DSN))
        val value = json("animals" to 120, "premium" to true, "nested" to json("deep" to "yes"))
        assertEquals("set", run("setContext", "account", value).strMessage)
        var account: Any? = null
        Sentry.configureScope { account = it.contexts["account"] }
        val map = account as Map<*, *>
        assertEquals(120, map["animals"])
        assertEquals(true, map["premium"])
        assertEquals("yes", (map["nested"] as Map<*, *>)["deep"])

        assertEquals("set", run("setContext", "account", null).strMessage)
        Sentry.configureScope { account = it.contexts["account"] }
        assertNull(account)
    }

    @Test
    fun `setContext converts arrays all the way down, so nothing JSON-typed reaches the scope`() {
        run("start", json("dsn" to DSN))
        val herds = JSONArray().put(json("id" to 1, "tags" to JSONArray().put("a").put(JSONObject.NULL))).put(JSONObject.NULL)
        assertEquals("set", run("setContext", "farm", json("herds" to herds)).strMessage)
        var farm: Any? = null
        Sentry.configureScope { farm = it.contexts["farm"] }
        val list = (farm as Map<*, *>)["herds"] as List<*>
        val first = list[0] as Map<*, *>
        assertEquals(1, first["id"])
        assertEquals(listOf("a", null), first["tags"])
        assertNull(list[1])
    }

    @Test
    fun `setContext without a key is refused`() {
        val result = run("setContext", "", json("x" to 1))
        assertEquals(PluginResult.Status.ERROR.ordinal, result.status)
    }

    private fun extras(): Map<String, String> {
        var seen: Map<String, Any?> = emptyMap()
        Sentry.configureScope { seen = it.extras }
        return seen.mapValues { it.value as String }
    }

    @Test
    fun `setExtras puts each extra on the scope as text, and null removes one`() {
        run("start", json("dsn" to DSN))
        run("setExtras", json("gone" to "soon"))
        assertEquals("set", run("setExtras", json("plain" to "text", "count" to "12", "json" to "{\"a\":[1]}", "gone" to null)).strMessage)
        val seen = extras()
        assertEquals("text", seen["plain"])
        assertEquals("12", seen["count"])
        assertEquals("{\"a\":[1]}", seen["json"])
        assertFalse(seen.containsKey("gone"))
    }

    @Test
    fun `extras set before start are kept, answered queued, and start applies the last change of each key`() {
        assertEquals("queued", run("setExtras", json("a" to "1", "gone" to "soon")).strMessage)
        assertEquals("queued", run("setExtras", json("a" to "2", "gone" to null, "b" to "3")).strMessage)
        assertFalse("nothing started the SDK", Sentry.isEnabled())

        // every key is its own change: the order the keys come in must not decide which of them survive
        run("start", json("dsn" to DSN))
        assertEquals(mapOf("a" to "2", "b" to "3"), extras())
    }

    @Test
    fun `setExtras without an object is refused`() {
        val result = run("setExtras", null)
        assertEquals(PluginResult.Status.ERROR.ordinal, result.status)
        assertTrue(result.message.contains("setExtras"))
    }

    @Test
    fun `isEnabled says whether the SDK is running, whoever started it`() {
        val before = run("isEnabled")
        assertEquals(PluginResult.Status.OK.ordinal, before.status)
        assertEquals(PluginResult.MESSAGE_TYPE_BOOLEAN, before.messageType)
        assertEquals("false", before.message)

        run("start", json("dsn" to DSN))
        assertEquals("true", run("isEnabled").message)

        Sentry.close()
        assertEquals("false", run("isEnabled").message)
        SentryAndroid.init(activity) { it.dsn = DSN }
        assertEquals("an SDK the app started counts", "true", run("isEnabled").message)
    }

    @Test
    fun `close stops the SDK and says so, says not running when there was none, and a start after it starts it again`() {
        assertEquals("not running", run("close").strMessage)

        run("start", json("dsn" to DSN))
        assertTrue(Sentry.isEnabled())
        assertEquals("closed", run("close").strMessage)
        assertFalse(Sentry.isEnabled())
        assertEquals("not running", run("close").strMessage)

        assertEquals("started", run("start", json("dsn" to DSN)).strMessage)
        assertTrue(Sentry.isEnabled())
    }

    @Test
    fun `close takes the allowCrash of the start that is over, and what the page sets while the SDK is down is kept for the next start`() {
        run("start", json("dsn" to DSN, "allowCrash" to true))
        run("close")
        assertEquals("a closed SDK has no crash to allow", PluginResult.Status.ERROR.ordinal, run("crash").status)

        assertEquals("queued", run("setTags", json("while" to "down")).strMessage)
        assertEquals("queued", run("setExtras", json("x" to "1")).strMessage)
        run("start", json("dsn" to DSN))
        var tags: Map<String, String> = emptyMap()
        Sentry.configureScope { tags = it.tags }
        assertEquals("down", tags["while"])
        assertEquals(mapOf("x" to "1"), extras())
        assertEquals("the new start did not allow it either", PluginResult.Status.ERROR.ordinal, run("crash").status)
    }

    @Test
    fun `a breadcrumb added after start lands on the scope with what it was given, nested data included`() {
        run("start", json("dsn" to DSN))
        val data = json("id" to 7, "ok" to true, "nested" to json("list" to JSONArray().put("a").put(1)), "gone" to null)
        val result = run("addBreadcrumb", json("type" to "http", "category" to "t.fetch", "message" to "GET /api", "level" to "warning", "data" to data, "timestamp" to 1_760_000_000.5))
        assertEquals("added", result.strMessage)

        val crumb = crumbs().single()
        assertEquals("http", crumb.type)
        assertEquals("GET /api", crumb.message)
        assertEquals(SentryLevel.WARNING, crumb.level)
        assertEquals(1_760_000_000_500L, crumb.timestamp.time)
        assertEquals(7, crumb.data["id"])
        assertEquals(true, crumb.data["ok"])
        assertEquals(mapOf("list" to listOf("a", 1)), crumb.data["nested"])
        assertFalse("a null value is a key that is not there", crumb.data.containsKey("gone"))
    }

    @Test
    fun `the levels are the SDK's, and a breadcrumb with none is info`() {
        run("start", json("dsn" to DSN))
        listOf("fatal", "error", "warning", "info", "debug").forEach { level -> run("addBreadcrumb", json("category" to "t.$level", "level" to level)) }
        run("addBreadcrumb", json("category" to "t.none"))
        val levels = crumbs().associate { it.category!! to it.level }
        assertEquals(SentryLevel.FATAL, levels["t.fatal"])
        assertEquals(SentryLevel.ERROR, levels["t.error"])
        assertEquals(SentryLevel.WARNING, levels["t.warning"])
        assertEquals(SentryLevel.INFO, levels["t.info"])
        assertEquals(SentryLevel.DEBUG, levels["t.debug"])
        assertEquals(SentryLevel.INFO, levels["t.none"])
    }

    @Test
    fun `breadcrumbs added before start are kept in order, answered queued, and start adds them`() {
        (1..3).forEach { assertEquals("queued", run("addBreadcrumb", json("category" to "t.$it", "message" to "m$it")).strMessage) }
        assertFalse("nothing started the SDK", Sentry.isEnabled())

        run("start", json("dsn" to DSN))
        assertEquals(listOf("m1", "m2", "m3"), crumbs().map { it.message })

        // what was kept is added once: a later one is the page's own, not a replay
        assertEquals("added", run("addBreadcrumb", json("category" to "t.4", "message" to "m4")).strMessage)
        assertEquals(listOf("m1", "m2", "m3", "m4"), crumbs().map { it.message })
    }

    @Test
    fun `a clear before start drops what was kept, and a clear after it empties the scope`() {
        run("addBreadcrumb", json("category" to "t.1", "message" to "dropped"))
        assertEquals("cleared", run("clearBreadcrumbs").strMessage)
        run("addBreadcrumb", json("category" to "t.2", "message" to "kept"))
        run("start", json("dsn" to DSN))
        assertEquals(listOf("kept"), crumbs().map { it.message })

        assertEquals("cleared", run("clearBreadcrumbs").strMessage)
        assertEquals(emptyList<String>(), crumbs().map { it.message })
    }

    @Test
    fun `the newest of more than a hundred breadcrumbs kept before start are what start adds`() {
        (1..130).forEach { run("addBreadcrumb", json("category" to "t.$it", "message" to "m$it")) }
        run("start", json("dsn" to DSN))
        val numbers = crumbs().map { it.message!!.drop(1).toInt() }
        // The SDK holds a hundred in all, its own among them, so one or two of the page's may go to make room for its start.
        assertTrue("${numbers.size} breadcrumbs", numbers.size in 98..100)
        assertEquals("the newest, in order, none missing", ((131 - numbers.size)..130).toList(), numbers)
    }

    @Test
    fun `addBreadcrumb without an object is refused`() {
        val result = run("addBreadcrumb", null)
        assertEquals(PluginResult.Status.ERROR.ordinal, result.status)
        assertTrue(result.message.contains("addBreadcrumb"))
    }

    @Test
    fun `crash is refused until a start allows it, and the last accepted start decides`() {
        val refused = run("crash")
        assertEquals(PluginResult.Status.ERROR.ordinal, refused.status)
        assertTrue(refused.message.contains("allowCrash"))

        run("start", json("dsn" to DSN))
        assertEquals("a start without the option does not allow it", PluginResult.Status.ERROR.ordinal, run("crash").status)

        run("start", json("dsn" to DSN, "allowCrash" to true))
        run("start", json("dsn" to DSN))
        assertEquals("the last start takes it away again", PluginResult.Status.ERROR.ordinal, run("crash").status)
    }

    @Test
    fun `crash throws on the main thread when start allowed it, which is what takes a process down`() {
        run("start", json("dsn" to DSN, "allowCrash" to true))
        // Robolectric runs the main looper on the test thread, so runOnUiThread runs the block here and the throw is observable.
        val thrown = assertThrows(RuntimeException::class.java) {
            plugin.execute("crash", JSONArray(), CallbackContext("x", webView))
        }
        assertTrue(thrown.message!!.contains("test crash"))
    }

    @Test
    fun `a start that finds the SDK running still takes the allowCrash it is given`() {
        run("start", json("dsn" to DSN))
        assertEquals("already started", run("start", json("dsn" to DSN, "allowCrash" to true)).strMessage)
        assertThrows(RuntimeException::class.java) {
            plugin.execute("crash", JSONArray(), CallbackContext("x", webView))
        }
    }

    companion object {
        /** A DSN whose host answers nothing: the SDK starts, and no project receives a test session. */
        private const val DSN = "https://0123456789abcdef0123456789abcdef@127.0.0.1:9/1"
    }
}
