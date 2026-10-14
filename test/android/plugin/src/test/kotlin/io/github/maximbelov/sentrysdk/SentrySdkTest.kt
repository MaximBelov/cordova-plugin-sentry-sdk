package io.github.maximbelov.sentrysdk

import androidx.appcompat.app.AppCompatActivity
import io.sentry.Sentry
import io.sentry.android.core.SentryAndroid
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
        verify(webView).sendPluginResult(sent.capture(), org.mockito.ArgumentMatchers.eq(id))
        return sent.value
    }

    private fun json(vararg pairs: Pair<String, Any?>) = JSONObject().apply { pairs.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) } }

    @Test
    fun `an unknown action is not handled`() {
        assertFalse(plugin.execute("nope", JSONArray(), CallbackContext("x", webView)))
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
