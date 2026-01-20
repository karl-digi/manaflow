import Foundation

enum UITestConfig {
    static var mockDataEnabled: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["CMUX_UITEST_MOCK_DATA"] == "1"
        #else
        return false
        #endif
    }
}
