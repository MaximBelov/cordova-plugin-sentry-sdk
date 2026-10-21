package io.github.maximbelov.sentrydemo;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;

/** For test/e2e only: every call fails, with the first argument as the message. */
public class DemoFailure extends CordovaPlugin {
    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) {
        callbackContext.error(args.optString(0, "DemoFailure failed"));
        return true;
    }
}
