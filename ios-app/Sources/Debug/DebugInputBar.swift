import SwiftUI
import UIKit

/// Shared floating glass input bar for all debug approaches
struct DebugInputBar: View {
    @Binding var text: String
    let onSend: () -> Void
    @Binding var isFocused: Bool
    @ObservedObject var layout: InputBarLayoutModel
    private let inputHeight: CGFloat = 42

    @FocusState private var textFieldFocused: Bool

    init(
        text: Binding<String>,
        isFocused: Binding<Bool> = .constant(false),
        layout: InputBarLayoutModel,
        onSend: @escaping () -> Void
    ) {
        self._text = text
        self._isFocused = isFocused
        self.layout = layout
        self.onSend = onSend
    }

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 12) {
                // Plus button with glass circle
                Button {} label: {
                    Image(systemName: "plus")
                        .font(.title3)
                        .fontWeight(.medium)
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
                .frame(width: inputHeight, height: inputHeight)
                .glassEffect(.regular.interactive(), in: .circle)

                // Text field with glass capsule
                HStack(spacing: 8) {
                    TextField("Message", text: $text, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($textFieldFocused)

                    ZStack {
                        if text.isEmpty {
                            Image(systemName: "mic.fill")
                                .font(.title2)
                                .foregroundStyle(.secondary)
                        } else {
                            Button(action: onSend) {
                                Image(systemName: "arrow.up.circle.fill")
                                    .font(.title)
                                    .foregroundStyle(.blue)
                            }
                        }
                    }
                    .frame(width: 32, height: 32)
                }
                .padding(.horizontal, 16)
                .frame(height: inputHeight)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
            .padding(.horizontal, layout.horizontalPadding)
            .padding(.top, 8)
            .padding(.bottom, layout.bottomPadding)
        }
        .animation(.easeInOut(duration: 0.15), value: text.isEmpty)
        .animation(.easeInOut(duration: 0.2), value: layout.horizontalPadding)
        .animation(.easeInOut(duration: 0.2), value: layout.bottomPadding)
        .onChange(of: textFieldFocused) { _, newValue in
            isFocused = newValue
        }
        .onChange(of: isFocused) { _, newValue in
            textFieldFocused = newValue
        }
    }
}

/// UIKit wrapper for the glass input bar
final class DebugInputBarViewController: UIViewController {
    var text: String = ""
    var onSend: (() -> Void)?
    var onTextChange: ((String) -> Void)?

    private var hostingController: UIHostingController<DebugInputBarWrapper>!
    private let layoutModel = InputBarLayoutModel(horizontalPadding: 20, bottomPadding: 28)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        let wrapper = DebugInputBarWrapper(
            text: Binding(get: { self.text }, set: { self.text = $0; self.onTextChange?($0) }),
            layout: layoutModel,
            onSend: { self.onSend?() }
        )
        hostingController = UIHostingController(rootView: wrapper)
        hostingController.view.backgroundColor = .clear
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        hostingController.safeAreaRegions = []

        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.didMove(toParent: self)

        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    func updateText(_ newText: String) {
        text = newText
        hostingController.rootView = DebugInputBarWrapper(
            text: Binding(get: { self.text }, set: { self.text = $0; self.onTextChange?($0) }),
            layout: layoutModel,
            onSend: { self.onSend?() }
        )
    }

    func clearText() {
        updateText("")
    }

    func updateLayout(horizontalPadding: CGFloat, bottomPadding: CGFloat) {
        if layoutModel.horizontalPadding != horizontalPadding {
            layoutModel.horizontalPadding = horizontalPadding
        }
        if layoutModel.bottomPadding != bottomPadding {
            layoutModel.bottomPadding = bottomPadding
        }
    }
}

private struct DebugInputBarWrapper: View {
    @Binding var text: String
    @ObservedObject var layout: InputBarLayoutModel
    let onSend: () -> Void

    var body: some View {
        DebugInputBar(text: $text, layout: layout, onSend: onSend)
    }
}

final class InputBarLayoutModel: ObservableObject {
    @Published var horizontalPadding: CGFloat
    @Published var bottomPadding: CGFloat

    init(horizontalPadding: CGFloat, bottomPadding: CGFloat) {
        self.horizontalPadding = horizontalPadding
        self.bottomPadding = bottomPadding
    }
}
