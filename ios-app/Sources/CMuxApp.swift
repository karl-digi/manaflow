import SwiftUI
import Sentry

@main
struct CMuxApp: App {
    init() {
        SentrySDK.start { options in
            options.dsn = "YOUR_DSN_HERE"
            options.debug = false

            #if DEBUG
            options.environment = "development"
            #elseif BETA
            options.environment = "beta"
            #else
            options.environment = "production"
            #endif

            options.enableTracing = true
            options.tracesSampleRate = 1.0
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
