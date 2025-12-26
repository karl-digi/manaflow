import Foundation
import Combine
import ConvexMobile

// Convex client singleton for the app
// Docs: https://docs.convex.dev/client/swift
// API: subscribe(to:with:), mutation(_:with:), action(_:with:)

@MainActor
class ConvexClientManager: ObservableObject {
    static let shared = ConvexClientManager()

    let client: ConvexClientWithAuth<StackAuthResult>
    private var cancellables = Set<AnyCancellable>()

    @Published var isAuthenticated = false

    private init() {
        let env = Environment.current
        let provider = StackAuthProvider()
        client = ConvexClientWithAuth(deploymentUrl: env.convexURL, authProvider: provider)
        print("📦 Convex initialized (\(env.name)): \(env.convexURL)")

        // Observe auth state changes
        client.authState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                switch state {
                case .authenticated:
                    self?.isAuthenticated = true
                    print("📦 Convex: Authenticated")
                case .unauthenticated:
                    self?.isAuthenticated = false
                    print("📦 Convex: Unauthenticated")
                case .loading:
                    print("📦 Convex: Auth loading...")
                }
            }
            .store(in: &cancellables)
    }

    /// Sync auth state with Stack Auth after user logs in via AuthManager
    func syncAuth() async {
        let result = await client.loginFromCache()
        switch result {
        case .success(let authResult):
            print("📦 Convex: Auth synced for \(authResult.user.primary_email ?? "unknown")")
        case .failure(let error):
            print("📦 Convex: Auth sync failed - \(error)")
        }
    }

    /// Clear Convex auth state when user logs out
    func clearAuth() async {
        await client.logout()
    }
}
