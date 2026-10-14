package io.github.maximbelov.sentrysdk

import androidx.appcompat.app.AppCompatActivity
import io.sentry.Sentry
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
    private lateinit var webView: CordovaWebView
    private lateinit var plugin: SentrySdk
    private var calls = 0

    @Before
    fun setUp() {
        // cordova-android's CordovaInterfaceImpl takes an AppCompatActivity, which needs an AppCompat theme to be created.
        val controller = Robolectric.buildActivity(AppCompatActivity::class.java)
        controller.get().setTheme(androidx.appcompat.R.style.Theme_AppCompat)
        val activity = controller.setup().get()
        webView = mock(CordovaWebView::class.java)
        plugin = SentrySdk()
        // the way Cordova hands a plugin its interface and web view
        plugin.privateInitialize("SentrySdk", CordovaInterfaceImpl(activity), webView, CordovaPreferences())
    }

    @After
    fun tearDown() {
        Sentry.close()
    }

    /** Runs an action the way Cordova does and returns what the plugin sent to JavaScript. */
    private fun run(action: String, vararg args: Any?): PluginResult {
        val id = "cb" + (++calls)
        val callback = CallbackContext(id, webView)
        val json = JSONArray()
        args.forEach { json.put(it ?: JSONObject.NULL) }
        assertTrue("the action is known: $action", plugin.execute(action, json, callback))
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
    fun `crash throws on the main thread, which is what takes a process down`() {
        // Robolectric runs the main looper on the test thread, so runOnUiThread runs the block here and the throw is observable.
        val thrown = assertThrows(RuntimeException::class.java) {
            plugin.execute("crash", JSONArray(), CallbackContext("x", webView))
        }
        assertTrue(thrown.message!!.contains("test crash"))
    }

    companion object {
        /** A DSN whose host answers nothing: the SDK starts, and no project receives a test session. */
        private const val DSN = "https://0123456789abcdef0123456789abcdef@127.0.0.1:9/1"
    }
}
