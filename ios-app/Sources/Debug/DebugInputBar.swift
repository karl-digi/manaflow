import Combine
import SwiftUI
import UIKit

enum DebugInputBarMetrics {
    static let inputHeight: CGFloat = 42
    static let maxInputHeight: CGFloat = 120
    static let topPadding: CGFloat = 8
    static let textVerticalPadding: CGFloat = 8
    static let pillCornerRadius: CGFloat = 18
    static let singleLineTolerance: CGFloat = 8

    static var singleLineEditorHeight: CGFloat {
        UIFont.preferredFont(forTextStyle: .body).lineHeight + textVerticalPadding
    }

    static func lineCount(for text: String) -> Int {
        max(1, text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).count)
    }

    static func editorHeight(for text: String) -> CGFloat {
        let lineHeight = UIFont.preferredFont(forTextStyle: .body).lineHeight
        let lineCount = lineCount(for: text)
        let rawHeight = lineHeight * CGFloat(lineCount) + textVerticalPadding
        return min(maxInputHeight, max(lineHeight + textVerticalPadding, rawHeight))
    }

    static func pillHeight(for text: String) -> CGFloat {
        max(inputHeight, editorHeight(for: text))
    }
}

/// Shared floating glass input bar for all debug approaches
struct DebugInputBar: View {
    @Binding var text: String
    let onSend: () -> Void
    @Binding var isFocused: Bool
    @ObservedObject var layout: InputBarLayoutModel
    @ObservedObject var geometry: InputBarGeometryModel

    @State private var textFieldFocused = false
    @State private var measuredTextHeight = DebugInputBarMetrics.singleLineEditorHeight
    @AppStorage("debug.input.bottomInsetSingleExtra") private var bottomInsetSingleExtra: Double = 0
    @AppStorage("debug.input.bottomInsetMultiExtra") private var bottomInsetMultiExtra: Double = 4
    @AppStorage("debug.input.topInsetMultiExtra") private var topInsetMultiExtra: Double = 4
    @AppStorage("debug.input.placeholderOffset") private var placeholderOffset: Double = 2
    @AppStorage("debug.input.micOffset") private var micOffset: Double = -12
    @AppStorage("debug.input.sendOffset") private var sendOffset: Double = -4
    @AppStorage("debug.input.sendXOffset") private var sendXOffset: Double = 1
    @AppStorage("debug.input.isMultiline") private var isMultilineFlag = false

    init(
        text: Binding<String>,
        isFocused: Binding<Bool> = .constant(false),
        geometry: InputBarGeometryModel,
        layout: InputBarLayoutModel,
        onSend: @escaping () -> Void
    ) {
        self._text = text
        self._isFocused = isFocused
        self.geometry = geometry
        self.layout = layout
        self.onSend = onSend
    }

    var body: some View {
        let fallbackHeight = DebugInputBarMetrics.editorHeight(for: text)
        let resolvedHeight = measuredTextHeight > 0 ? measuredTextHeight : fallbackHeight
        let editorHeight = min(
            DebugInputBarMetrics.maxInputHeight,
            max(fallbackHeight, resolvedHeight)
        )
        let isSingleLine = editorHeight
            <= DebugInputBarMetrics.singleLineEditorHeight + DebugInputBarMetrics.singleLineTolerance
        let showDebugOverlays = DebugSettings.showChatOverlays
        let bottomInsetExtra = isSingleLine ? bottomInsetSingleExtra : bottomInsetMultiExtra
        let topInsetExtra = isSingleLine ? 0 : topInsetMultiExtra
        let pillHeight = max(DebugInputBarMetrics.inputHeight, editorHeight)
        let singleLineCap = DebugInputBarMetrics.inputHeight + DebugInputBarMetrics.singleLineTolerance
        let cornerRadius: CGFloat = pillHeight <= singleLineCap
            ? pillHeight / 2
            : DebugInputBarMetrics.pillCornerRadius
        let pillShape = AnyShape(
            RoundedRectangle(
                cornerRadius: cornerRadius,
                style: .continuous
            )
        )

        return GlassEffectContainer {
            HStack(alignment: .bottom, spacing: 12) {
                plusButton
                inputPillView(
                    editorHeight: editorHeight,
                    isSingleLine: isSingleLine,
                    pillHeight: pillHeight,
                    pillShape: pillShape,
                    showDebugOverlays: showDebugOverlays,
                    placeholderOffset: CGFloat(placeholderOffset),
                    micOffset: CGFloat(micOffset),
                    bottomInsetExtra: CGFloat(bottomInsetExtra),
                    topInsetExtra: CGFloat(topInsetExtra),
                    sendOffset: CGFloat(sendOffset),
                    sendXOffset: CGFloat(sendXOffset)
                )
            }
            .padding(.horizontal, layout.horizontalPadding)
            .padding(.top, DebugInputBarMetrics.topPadding)
            .padding(.bottom, layout.bottomPadding)
        }
        .animation(.easeInOut(duration: 0.15), value: text.isEmpty)
        .animation(.easeInOut(duration: layout.animationDuration), value: layout.horizontalPadding)
        .animation(.easeInOut(duration: layout.animationDuration), value: layout.bottomPadding)
        .onAppear {
            textFieldFocused = isFocused
            if geometry.pillHeight != pillHeight {
                geometry.pillHeight = pillHeight
            }
        }
        .onChange(of: pillHeight) { _, newValue in
            if geometry.pillHeight != newValue {
                geometry.pillHeight = newValue
            }
        }
        .onChange(of: textFieldFocused) { _, newValue in
            isFocused = newValue
        }
        .onChange(of: isFocused) { _, newValue in
            textFieldFocused = newValue
        }
        .onAppear {
            isMultilineFlag = !isSingleLine
        }
        .onChange(of: isSingleLine) { _, newValue in
            isMultilineFlag = !newValue
        }
    }

    private var plusButton: some View {
        Button {} label: {
            Image(systemName: "plus")
                .font(.title3)
                .fontWeight(.medium)
                .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
        .frame(width: DebugInputBarMetrics.inputHeight, height: DebugInputBarMetrics.inputHeight)
        .glassEffect(.regular.interactive(), in: .circle)
    }

    @ViewBuilder
    private func inputPillView(
        editorHeight: CGFloat,
        isSingleLine: Bool,
        pillHeight: CGFloat,
        pillShape: AnyShape,
        showDebugOverlays: Bool,
        placeholderOffset: CGFloat,
        micOffset: CGFloat,
        bottomInsetExtra: CGFloat,
        topInsetExtra: CGFloat,
        sendOffset: CGFloat,
        sendXOffset: CGFloat
    ) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            inputFieldView(
                editorHeight: editorHeight,
                isSingleLine: isSingleLine,
                showDebugOverlays: showDebugOverlays,
                placeholderOffset: placeholderOffset,
                bottomInsetExtra: bottomInsetExtra,
                topInsetExtra: topInsetExtra
            )
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Image(systemName: "mic.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .offset(y: micOffset)
                    .padding(.trailing, 8)
            } else {
                Button(action: onSend) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .blue)
                        .offset(x: sendXOffset, y: sendOffset)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat.sendButton")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .frame(
            height: pillHeight,
            alignment: .bottom
        )
        .glassEffect(.regular.interactive(), in: pillShape)
        .clipShape(pillShape)
        .mask(pillShape)
        .clipped()
        .background(
            InputBarFrameReader { frame in
                geometry.pillFrameInWindow = frame
            }
        )
        .background(showDebugOverlays ? Color.red.opacity(0.08) : Color.clear)
        .overlay(
            Group {
                if showDebugOverlays {
                    pillShape.stroke(Color.red.opacity(0.6), lineWidth: 1)
                }
            }
        )
        .overlay(
            Color.clear
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("chat.inputPill")
                .accessibilityElement()
                .allowsHitTesting(false)
        )
        .contentShape(pillShape)
        .onTapGesture {
            textFieldFocused = true
        }
        .overlay(alignment: .topLeading) {
            if UITestConfig.mockDataEnabled {
                Button {
                    text = "Line 1\nLine 2\nLine 3"
                } label: {
                    Color.clear
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("chat.debugSetMultiline")
            }
        }
    }

    @ViewBuilder
    private func inputFieldView(
        editorHeight: CGFloat,
        isSingleLine: Bool,
        showDebugOverlays: Bool,
        placeholderOffset: CGFloat,
        bottomInsetExtra: CGFloat,
        topInsetExtra: CGFloat
    ) -> some View {
        let shouldCenter = text.isEmpty || isSingleLine
        let singleLineOffset = isSingleLine ? -bottomInsetExtra / 2 : 0
        let inputField = ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text("Message")
                    .foregroundStyle(.secondary)
                    .font(.body)
                    .padding(.top, 2 + placeholderOffset)
            }
            InputTextView(
                text: $text,
                measuredHeight: $measuredTextHeight,
                bottomInsetExtra: bottomInsetExtra,
                topInsetExtra: topInsetExtra,
                isFocused: $textFieldFocused
            )
                .frame(height: editorHeight)
        }
        .clipped()
        .offset(y: singleLineOffset)
        .background(showDebugOverlays ? Color.blue.opacity(0.12) : Color.clear)
        .overlay(
            Group {
                if showDebugOverlays {
                    Rectangle()
                        .stroke(Color.blue.opacity(0.6), lineWidth: 1)
                }
            }
        )
        .background(
            InputBarFrameReader { frame in
                geometry.inputFrameInWindow = frame
            }
        )
        if shouldCenter {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                inputField
                Spacer(minLength: 0)
            }
            .frame(maxHeight: .infinity)
        } else {
            VStack(spacing: 0) {
                inputField
            }
        }
    }
}

/// UIKit wrapper for the glass input bar
final class DebugInputBarViewController: UIViewController {
    var text: String {
        get { textModel.text }
        set { textModel.text = newValue }
    }
    var onSend: (() -> Void)?
    var onTextChange: ((String) -> Void)?
    private let textModel = InputBarTextModel()
    var onLayoutChange: (() -> Void)?
    var contentTopInset: CGFloat { DebugInputBarMetrics.topPadding }
    var contentBottomInset: CGFloat { layoutModel.bottomPadding }
    var pillMeasuredFrame: CGRect { geometryModel.pillFrameInWindow }
    var pillFrameInView: CGRect {
        if let window = view.window, pillMeasuredFrame != .zero {
            return view.convert(pillMeasuredFrame, from: window)
        }
        let viewHeight = view.bounds.height
        guard viewHeight > 0 else { return .zero }
        let fallbackHeight = DebugInputBarMetrics.pillHeight(for: textModel.text)
        let targetPillHeight = geometryModel.pillHeight > 0 ? geometryModel.pillHeight : fallbackHeight
        let expectedHeight = contentTopInset + contentBottomInset + targetPillHeight
        let extra = max(0, viewHeight - expectedHeight)
        let offset = extra / 2
        let topLimit = contentTopInset + offset
        let bottomLimit = max(topLimit, viewHeight - contentBottomInset - offset)
        let availableHeight = max(0, bottomLimit - topLimit)
        let height = min(targetPillHeight, availableHeight)
        return CGRect(x: 0, y: topLimit, width: view.bounds.width, height: height)
    }
    var pillHeight: CGFloat { max(0, pillFrameInView.height) }

    private var hostingController: UIHostingController<DebugInputBarWrapper>!
    private let layoutModel = InputBarLayoutModel(horizontalPadding: 20, bottomPadding: 28)
    private var lastReportedHeight: CGFloat = 0
    private let focusModel = InputBarFocusModel()
    private let geometryModel = InputBarGeometryModel()
    private var geometryCancellable: AnyCancellable?
    private var inputGeometryCancellable: AnyCancellable?
    private var textCancellable: AnyCancellable?
    private let inputAccessibilityView = UIView()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        hostingController = UIHostingController(rootView: makeWrapper())
        hostingController.view.backgroundColor = .clear
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        hostingController.safeAreaRegions = []

        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.didMove(toParent: self)

        inputAccessibilityView.isAccessibilityElement = true
        inputAccessibilityView.accessibilityIdentifier = "chat.inputValue"
        inputAccessibilityView.backgroundColor = .clear
        inputAccessibilityView.isUserInteractionEnabled = false
        view.addSubview(inputAccessibilityView)

        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        geometryCancellable = geometryModel.$pillFrameInWindow
            .removeDuplicates()
            .sink { [weak self] _ in
                self?.onLayoutChange?()
            }
        inputGeometryCancellable = geometryModel.$inputFrameInWindow
            .removeDuplicates()
            .sink { [weak self] _ in
                self?.updateInputAccessibilityFrame()
            }
        textCancellable = textModel.$text
            .removeDuplicates()
            .sink { [weak self] value in
                self?.inputAccessibilityView.accessibilityValue = value
                self?.onLayoutChange?()
            }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let height = view.bounds.height
        if abs(height - lastReportedHeight) > 0.5 {
            lastReportedHeight = height
            onLayoutChange?()
        }
        updateInputAccessibilityFrame()
    }

    func updateText(_ newText: String) {
        textModel.text = newText
    }

    func clearText() {
        textModel.text = ""
    }

    func updateLayout(horizontalPadding: CGFloat, bottomPadding: CGFloat, animationDuration: Double) {
        if layoutModel.horizontalPadding != horizontalPadding {
            layoutModel.horizontalPadding = horizontalPadding
        }
        if layoutModel.bottomPadding != bottomPadding {
            layoutModel.bottomPadding = bottomPadding
        }
        if abs(layoutModel.animationDuration - animationDuration) > 0.001 {
            layoutModel.animationDuration = animationDuration
        }
    }

    func setFocused(_ focused: Bool) {
        focusModel.isFocused = focused
    }

    func setEnabled(_ enabled: Bool) {
        view.isUserInteractionEnabled = enabled
        view.alpha = enabled ? 1.0 : 0.6
    }

    func preferredHeight(for width: CGFloat) -> CGFloat {
        let maxHeight = DebugInputBarMetrics.maxInputHeight + contentTopInset + contentBottomInset
        let fallbackHeight = DebugInputBarMetrics.pillHeight(for: textModel.text)
        let measuredHeight = geometryModel.pillHeight
        let pillHeight = measuredHeight > 0 ? measuredHeight : fallbackHeight
        let targetHeight = pillHeight + contentTopInset + contentBottomInset
        return min(targetHeight, maxHeight)
    }

    private func updateInputAccessibilityFrame() {
        let frame = geometryModel.inputFrameInWindow
        guard let window = view.window, frame != .zero else { return }
        let converted = view.convert(frame, from: window)
        if converted != inputAccessibilityView.frame {
            inputAccessibilityView.frame = converted
        }
    }

    private func makeWrapper() -> DebugInputBarWrapper {
        DebugInputBarWrapper(
            textModel: textModel,
            focus: focusModel,
            geometry: geometryModel,
            layout: layoutModel,
            onTextChange: onTextChange,
            onSend: { self.onSend?() }
        )
    }
}

private struct DebugInputBarWrapper: View {
    @ObservedObject var textModel: InputBarTextModel
    @ObservedObject var focus: InputBarFocusModel
    @ObservedObject var geometry: InputBarGeometryModel
    @ObservedObject var layout: InputBarLayoutModel
    let onTextChange: ((String) -> Void)?
    let onSend: () -> Void

    var body: some View {
        DebugInputBar(
            text: Binding(
                get: { textModel.text },
                set: { textModel.text = $0; onTextChange?($0) }
            ),
            isFocused: $focus.isFocused,
            geometry: geometry,
            layout: layout,
            onSend: onSend
        )
    }
}

final class InputBarLayoutModel: ObservableObject {
    @Published var horizontalPadding: CGFloat
    @Published var bottomPadding: CGFloat
    @Published var animationDuration: Double

    init(horizontalPadding: CGFloat, bottomPadding: CGFloat) {
        self.horizontalPadding = horizontalPadding
        self.bottomPadding = bottomPadding
        self.animationDuration = 0.2
    }
}

final class InputBarFocusModel: ObservableObject {
    @Published var isFocused = false
}

final class InputBarTextModel: ObservableObject {
    @Published var text = ""
}

final class InputBarGeometryModel: ObservableObject {
    @Published var pillFrameInWindow: CGRect = .zero
    @Published var inputFrameInWindow: CGRect = .zero
    @Published var pillHeight: CGFloat = DebugInputBarMetrics.inputHeight
}

private struct InputTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat
    let bottomInsetExtra: CGFloat
    let topInsetExtra: CGFloat
    @Binding var isFocused: Bool

    func makeUIView(context: Context) -> MeasuringTextView {
        let textView = MeasuringTextView()
        textView.delegate = context.coordinator
        textView.isScrollEnabled = false
        textView.clipsToBounds = true
        textView.backgroundColor = .clear
        textView.font = UIFont.preferredFont(forTextStyle: .body)
        let verticalInset = DebugInputBarMetrics.textVerticalPadding / 2
        textView.textContainerInset = UIEdgeInsets(
            top: verticalInset + topInsetExtra,
            left: 0,
            bottom: verticalInset + bottomInsetExtra,
            right: 0
        )
        textView.textContainer.lineFragmentPadding = 0
        textView.returnKeyType = .default
        textView.text = text
        textView.accessibilityIdentifier = "chat.inputField"
        textView.accessibilityValue = text
        textView.onHeightChange = { [weak coordinator = context.coordinator] height in
            coordinator?.updateMeasuredHeight(height)
        }
        return textView
    }

    func updateUIView(_ uiView: MeasuringTextView, context: Context) {
        if uiView.text != text {
            uiView.text = text
        }
        let verticalInset = DebugInputBarMetrics.textVerticalPadding / 2
        let targetInset = UIEdgeInsets(
            top: verticalInset + topInsetExtra,
            left: 0,
            bottom: verticalInset + bottomInsetExtra,
            right: 0
        )
        if uiView.textContainerInset != targetInset {
            uiView.textContainerInset = targetInset
        }
        uiView.onHeightChange = { [weak coordinator = context.coordinator] height in
            coordinator?.updateMeasuredHeight(height)
        }
        if isFocused && !uiView.isFirstResponder {
            uiView.becomeFirstResponder()
        } else if !isFocused && uiView.isFirstResponder {
            uiView.resignFirstResponder()
        }
        uiView.accessibilityValue = text
        uiView.setNeedsLayout()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        private let parent: InputTextView

        init(parent: InputTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            textView.setNeedsLayout()
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }

        func updateMeasuredHeight(_ height: CGFloat) {
            if abs(parent.measuredHeight - height) > 0.5 {
                parent.measuredHeight = height
            }
        }
    }
}

private final class MeasuringTextView: UITextView {
    var onHeightChange: ((CGFloat) -> Void)?
    private var lastMeasuredHeight: CGFloat = 0

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0 else { return }
        let fittingSize = CGSize(width: bounds.width, height: .greatestFiniteMagnitude)
        let fittingHeight = sizeThatFits(fittingSize).height
        let clampedHeight = min(DebugInputBarMetrics.maxInputHeight, fittingHeight)
        let shouldScroll = fittingHeight > DebugInputBarMetrics.maxInputHeight + 0.5
        if isScrollEnabled != shouldScroll {
            isScrollEnabled = shouldScroll
        }
        if abs(clampedHeight - lastMeasuredHeight) > 0.5 {
            lastMeasuredHeight = clampedHeight
            onHeightChange?(clampedHeight)
        }
    }
}

private struct InputBarFrameReader: UIViewRepresentable {
    let onFrame: (CGRect) -> Void

    func makeUIView(context: Context) -> InputBarFrameReaderView {
        InputBarFrameReaderView(onFrame: onFrame)
    }

    func updateUIView(_ uiView: InputBarFrameReaderView, context: Context) {
        uiView.onFrame = onFrame
        uiView.setNeedsLayout()
    }
}

private final class InputBarFrameReaderView: UIView {
    var onFrame: (CGRect) -> Void
    private var lastFrame: CGRect = .zero

    init(onFrame: @escaping (CGRect) -> Void) {
        self.onFrame = onFrame
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) {
        return nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let window else { return }
        let frameInWindow = convert(bounds, to: window)
        if frameInWindow != lastFrame {
            lastFrame = frameInWindow
            onFrame(frameInWindow)
        }
    }
}
