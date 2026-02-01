import AuthenticationServices
import StackAuth
import SwiftUI
import Sentry
import UIKit

struct SignInView: View {
    @StateObject private var authManager = AuthManager.shared
    @State private var email = ""
    @State private var code = ""
    @State private var showCodeEntry = false
    @State private var error: String?
    @State private var isAppleSigningIn = false
    @SwiftUI.Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NavigationStack {
            ZStack {
                GameOfLifeHeader()
                    .ignoresSafeArea()
                
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        dismissKeyboard()
                    }
                    .ignoresSafeArea()

                VStack(spacing: 6) {
                    Text("cmux")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.primary)

                    Text("Sign in to continue")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 56)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    if !showCodeEntry {
                        emailEntryView
                    } else {
                        codeEntryView
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 20)
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Email Entry

    private var emailEntryView: some View {
        authCard {
            VStack(spacing: 20) {
                appleSignInView

                DividerLabel(text: "or continue with email")

                VStack(spacing: 12) {
                    TextField("Email address", text: $email)
                        .textFieldStyle(.plain)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocapitalization(.none)
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color(.tertiarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    Button {
                        Task { await sendCode() }
                    } label: {
                        if showEmailLoader {
                            ProgressView()
                                .tint(buttonForeground)
                                .frame(maxWidth: .infinity)
                                .padding()
                        } else {
                            Text("Email me a code")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .padding()
                        }
                    }
                    .background(email.isEmpty ? Color(.systemGray4) : Color.primary)
                    .foregroundStyle(buttonForeground)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .disabled(email.isEmpty || authManager.isLoading || isAppleSigningIn)
                }

                if let error {
                    errorText(error)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Code Entry

    private var codeEntryView: some View {
        authCard {
            VStack(spacing: 18) {
                VStack(spacing: 6) {
                    Text("Check your email")
                        .font(.headline)

                    Text("We sent a code to \(email)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                TextField("000000", text: $code)
                    .textFieldStyle(.plain)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.system(size: 32, weight: .semibold, design: .monospaced))
                    .padding()
                    .background(Color(.tertiarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onChange(of: code) { _, newValue in
                        if newValue.count > 6 {
                            code = String(newValue.prefix(6))
                        }
                        if newValue.count == 6 {
                            Task { await verifyCode() }
                        }
                    }

                if let error {
                    errorText(error)
                }

                Button {
                    Task { await verifyCode() }
                } label: {
                    if showEmailLoader {
                        ProgressView()
                            .tint(buttonForeground)
                            .frame(maxWidth: .infinity)
                            .padding()
                    } else {
                        Text("Verify code")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding()
                    }
                }
                .background(code.count == 6 ? Color.primary : Color(.systemGray4))
                .foregroundStyle(buttonForeground)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .disabled(code.count != 6 || authManager.isLoading || isAppleSigningIn)

                Button("Use a different email") {
                    withAnimation {
                        showCodeEntry = false
                        code = ""
                        error = nil
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Actions

    private func sendCode() async {
        error = nil

        do {
            try await authManager.sendCode(to: email)
            withAnimation {
                showCodeEntry = true
            }
        } catch let err {
            error = detailedErrorMessage(err)
            print("🔐 Email code request failed: \(err)")
            SentrySDK.capture(error: err)
        }
    }

    private func verifyCode() async {
        error = nil
        do {
            try await authManager.verifyCode(code)
            // Auth state will update automatically via @Published
        } catch let err {
            error = detailedErrorMessage(err)
            print("🔐 Email code verification failed: \(err)")
            SentrySDK.capture(error: err)
            code = ""
        }
    }

    private var appleSignInView: some View {
        ZStack {
            AppleSignInButton(isLoading: authManager.isLoading || isAppleSigningIn) {
                Task { await signInWithApple() }
            }
            .frame(height: 54)
            .accessibilityIdentifier("signin.apple")

            if isAppleSigningIn {
                ProgressView()
                    .tint(appleProgressColor)
            }
        }
    }

    private func signInWithApple() async {
        error = nil
        isAppleSigningIn = true
        defer { isAppleSigningIn = false }

        do {
            try await authManager.signInWithApple()
        } catch let err {
            if let stackError = err as? StackAuthErrorProtocol, stackError.code == "oauth_cancelled" {
                return
            }
            error = detailedErrorMessage(err)
            print("🔐 Apple Sign In failed: \(err)")
            SentrySDK.capture(error: err)
        }
    }

    private var backgroundView: some View {
        LinearGradient(
            colors: [Color(.systemBackground), Color(.secondarySystemBackground)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }

    private func authCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(20)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(Color(.secondarySystemBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(Color(.separator).opacity(0.35), lineWidth: 1)
            )
    }

    private func errorText(_ message: String) -> some View {
        Text(message)
            .font(.caption)
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }

    private func detailedErrorMessage(_ error: Error) -> String {
        var lines: [String] = []

        let localized = error.localizedDescription
        if !localized.isEmpty {
            lines.append(localized)
        }

        lines.append("Type: \(String(reflecting: type(of: error)))")

        if let stackError = error as? StackAuthErrorProtocol {
            lines.append("Code: \(stackError.code)")
            lines.append("Message: \(stackError.message)")
            if let details = stackError.details {
                lines.append("Details: \(details)")
            }
        }

        let nsError = error as NSError
        lines.append("NSError domain: \(nsError.domain)")
        lines.append("NSError code: \(nsError.code)")
        if !nsError.userInfo.isEmpty {
            lines.append("UserInfo: \(nsError.userInfo)")
        }

        return lines.joined(separator: "\n")
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private var buttonForeground: Color {
        Color(.systemBackground)
    }

    private var appleProgressColor: Color {
        colorScheme == .dark ? Color.black : Color.white
    }

    private var showEmailLoader: Bool {
        authManager.isLoading && !isAppleSigningIn
    }
}

private struct AppleSignInButton: UIViewRepresentable {
    let isLoading: Bool
    let action: () -> Void
    @SwiftUI.Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let style: ASAuthorizationAppleIDButton.Style = colorScheme == .dark ? .white : .black
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: style)
        button.cornerRadius = 12
        button.addTarget(context.coordinator, action: #selector(Coordinator.didTap), for: .touchUpInside)
        button.isEnabled = !isLoading
        return button
    }

    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {
        uiView.isEnabled = !isLoading
        uiView.alpha = isLoading ? 0.7 : 1.0
    }

    final class Coordinator: NSObject {
        private let action: () -> Void

        init(action: @escaping () -> Void) {
            self.action = action
        }

        @objc func didTap() {
            action()
        }
    }
}

private struct DividerLabel: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            dividerLine
            Text(text)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .allowsTightening(true)
                .layoutPriority(1)
            dividerLine
        }
    }

    private var dividerLine: some View {
        Rectangle()
            .fill(Color(.separator).opacity(0.4))
            .frame(height: 1)
    }
}

private struct GameOfLifeHeader: View {
    private let columns = 36
    private let rows = 52

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                GameOfLifeGrid(columns: columns, rows: rows)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 6)

                LinearGradient(
                    colors: [Color(.systemBackground).opacity(0.0), Color(.systemBackground).opacity(0.98)],
                    startPoint: .center,
                    endPoint: .bottom
                )
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .clipped()
    }
}

private struct GameOfLifeGrid: View {
    let columns: Int
    let rows: Int

    @State private var cells: [Bool] = []
    @State private var stepCount = 0

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.08)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            let tick = Int(time / 0.08)

            GeometryReader { proxy in
                Canvas { context, size in
                    let cellWidth = size.width / CGFloat(columns)
                    let cellHeight = size.height / CGFloat(rows)
                    let cellSize = min(cellWidth, cellHeight) * 0.52
                    let yOffset = (cellHeight - cellSize) * 0.5
                    let xOffset = (cellWidth - cellSize) * 0.5

                    for row in 0..<rows {
                        for col in 0..<columns {
                            if isAlive(row: row, col: col) {
                                let flicker = 0.45 + 0.35 * sin(time * 2.4 + Double(row * 3 + col) * 0.18)
                                let rect = CGRect(
                                    x: CGFloat(col) * cellWidth + xOffset,
                                    y: CGFloat(row) * cellHeight + yOffset,
                                    width: cellSize,
                                    height: cellSize
                                )
                                context.fill(
                                    Path(roundedRect: rect, cornerRadius: cellSize * 0.22),
                                    with: .color(Color(.systemGray2).opacity(flicker))
                                )
                            }
                        }
                    }
                }
            }
            .onChange(of: tick) { _, _ in
                step()
            }
            .onAppear {
                if cells.isEmpty {
                    seed()
                }
            }
        }
    }

    private func index(row: Int, col: Int) -> Int {
        row * columns + col
    }

    private func isAlive(row: Int, col: Int) -> Bool {
        let wrappedRow = (row + rows) % rows
        let wrappedCol = (col + columns) % columns
        let idx = index(row: wrappedRow, col: wrappedCol)
        if idx < cells.count {
            return cells[idx]
        }
        return false
    }

    private func seed() {
        var rng = SystemRandomNumberGenerator()
        cells = (0..<(rows * columns)).map { _ in
            Double.random(in: 0...1, using: &rng) < 0.38
        }
        stepCount = 0
    }

    private func step() {
        guard !cells.isEmpty else {
            seed()
            return
        }

        var next = cells
        var aliveCount = 0

        for row in 0..<rows {
            for col in 0..<columns {
                let idx = index(row: row, col: col)
                let neighbors = neighborCount(row: row, col: col)
                let alive = cells[idx]
                let nextAlive = (alive && (neighbors == 2 || neighbors == 3)) || (!alive && neighbors == 3)
                next[idx] = nextAlive
                if nextAlive {
                    aliveCount += 1
                }
            }
        }

        stepCount += 1

        if aliveCount < max(6, (rows * columns) / 12) || stepCount > 120 {
            seed()
            return
        }

        cells = next
    }

    private func neighborCount(row: Int, col: Int) -> Int {
        var count = 0
        for dr in -1...1 {
            for dc in -1...1 {
                if dr == 0 && dc == 0 {
                    continue
                }
                if isAlive(row: row + dr, col: col + dc) {
                    count += 1
                }
            }
        }
        return count
    }
}

#Preview {
    SignInView()
}
