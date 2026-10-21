#import "DemoFailure.h"

@implementation DemoFailure

- (void)fail:(CDVInvokedUrlCommand *)command
{
    id message = [command argumentAtIndex:0 withDefault:@"DemoFailure failed"];
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[message description]];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

@end
