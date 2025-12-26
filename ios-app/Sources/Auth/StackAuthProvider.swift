import Foundation
import ConvexMobile

// Stack Auth provider for Convex authentication
// Implements ConvexMobile's AuthProvider protocol

/// Auth result containing the access token and user info
struct StackAuthResult {
    let accessToken: String
    let user: StackAuthClient.User
}

/// Stack Auth provider for use with ConvexClientWithAuth
/// Note: Stack Auth uses OTP flow which requires UI, so login() is not supported.
/// Use AuthManager directly for interactive login, then call loginFromCache() to sync with Convex.
class StackAuthProvider: AuthProvider {
    typealias T = StackAuthResult

    private let client = StackAuthClient.shared
    private let keychain = KeychainHelper.shared

    /// Not supported - Stack Auth requires OTP flow with UI
    /// Use AuthManager.sendCode() and verifyCode() instead, then call loginFromCache()
    func login() async throws -> StackAuthResult {
        throw AuthError.unauthorized
    }

    /// Logout and clear tokens
    func logout() async throws {
        if let refreshToken = keychain.get("refresh_token") {
            try? await client.signOut(refreshToken: refreshToken)
        }
        keychain.delete("access_token")
        keychain.delete("refresh_token")
        print("🔐 Stack Auth: Logged out")
    }

    /// Re-authenticate using stored refresh token
    func loginFromCache() async throws -> StackAuthResult {
        guard let refreshToken = keychain.get("refresh_token") else {
            print("🔐 Stack Auth: No refresh token for cache login")
            throw AuthError.unauthorized
        }

        let accessToken = try await client.refreshAccessToken(refreshToken: refreshToken)
        keychain.set(accessToken, forKey: "access_token")

        let user = try await client.getCurrentUser(accessToken: accessToken)
        print("🔐 Stack Auth: Cache login successful for \(user.primary_email ?? "unknown")")

        return StackAuthResult(accessToken: accessToken, user: user)
    }

    /// Extract JWT token for Convex authentication
    func extractIdToken(from authResult: StackAuthResult) -> String {
        return authResult.accessToken
    }
}
