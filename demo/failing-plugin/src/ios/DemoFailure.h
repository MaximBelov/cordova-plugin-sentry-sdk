#import <Cordova/CDVPlugin.h>

// For test/e2e only: every call fails, with the first argument as the message.
@interface DemoFailure : CDVPlugin

- (void)fail:(CDVInvokedUrlCommand *)command;

@end
