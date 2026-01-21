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

    static func editorHeight(
        for text: String,
        topInsetExtra: CGFloat = 0,
        bottomInsetExtra: CGFloat = 0
    ) -> CGFloat {
        let lineHeight = UIFont.preferredFont(forTextStyle: .body).lineHeight
        let lineCount = lineCount(for: text)
        let insetExtra = topInsetExtra + bottomInsetExtra
        let rawHeight = lineHeight * CGFloat(lineCount) + textVerticalPadding + insetExtra
        let minHeight = lineHeight + textVerticalPadding + insetExtra
        return min(maxInputHeight, max(minHeight, rawHeight))
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
    @State private var measuredLineCount = 1
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
        let rawText = text
        let isTextEmpty = rawText.isEmpty
        let fallbackLineCount = DebugInputBarMetrics.lineCount(for: rawText)
        let effectiveLineCount = max(1, measuredLineCount)
        let isMultilineCandidate = !isTextEmpty && (effectiveLineCount > 1 || fallbackLineCount > 1)
        let candidateBottomInsetExtra = isMultilineCandidate ? bottomInsetMultiExtra : bottomInsetSingleExtra
        let candidateTopInsetExtra = isMultilineCandidate ? topInsetMultiExtra : 0
        let fallbackHeight = DebugInputBarMetrics.editorHeight(
            for: rawText,
            topInsetExtra: CGFloat(candidateTopInsetExtra),
            bottomInsetExtra: CGFloat(candidateBottomInsetExtra)
        )
        let resolvedHeight = measuredTextHeight > 0 ? measuredTextHeight : fallbackHeight
        let singleLineHeightCap = DebugInputBarMetrics.singleLineEditorHeight
            + DebugInputBarMetrics.singleLineTolerance
        let isSingleLine = isTextEmpty
            || ((effectiveLineCount <= 1 && fallbackLineCount <= 1)
                && resolvedHeight <= singleLineHeightCap)
        let targetHeight = isSingleLine ? fallbackHeight : max(fallbackHeight, resolvedHeight)
        let editorHeight = min(DebugInputBarMetrics.maxInputHeight, targetHeight)
        let shouldCenter = isTextEmpty || isSingleLine
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
                    isTextEmpty: isTextEmpty,
                    shouldCenter: shouldCenter,
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
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
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
        isTextEmpty: Bool,
        shouldCenter: Bool,
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
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 8) {
                inputFieldView(
                    editorHeight: editorHeight,
                    isSingleLine: isSingleLine,
                    isTextEmpty: isTextEmpty,
                    shouldCenter: shouldCenter,
                    showDebugOverlays: showDebugOverlays,
                    placeholderOffset: placeholderOffset,
                    bottomInsetExtra: bottomInsetExtra,
                    topInsetExtra: topInsetExtra
                )
                if isTextEmpty {
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
        }
        .frame(height: pillHeight, alignment: .bottom)
        .glassEffect(.regular.interactive(), in: pillShape)
        .clipShape(pillShape)
        .mask(pillShape)
        .clipped()
        .animation(.easeInOut(duration: 0.15), value: pillHeight)
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
                .accessibilityIdentifier("chat.inputPillFrame")
                .accessibilityElement(children: .ignore)
                .allowsHitTesting(false)
        )
        .overlay(
            Color.clear
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("chat.inputPill")
                .accessibilityElement(children: .ignore)
                .allowsHitTesting(false)
        )
        .overlay(alignment: .bottom) {
            Color.clear
                .frame(height: 1)
                .accessibilityIdentifier("chat.inputPillBottomEdge")
                .accessibilityElement(children: .ignore)
                .allowsHitTesting(false)
        }
        .contentShape(pillShape)
        .onTapGesture {
            textFieldFocused = true
        }
        .overlay(alignment: .topLeading) {
            if UITestConfig.mockDataEnabled {
                VStack(spacing: 0) {
                    Button {
                        text = "Line 1\nLine 2\nLine 3"
                    } label: {
                        Color.clear
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("chat.debugSetMultiline")

                    Button {
                        text = ""
                    } label: {
                        Color.clear
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("chat.debugClearInput")
                }
            }
        }
    }

    @ViewBuilder
    private func inputFieldView(
        editorHeight: CGFloat,
        isSingleLine: Bool,
        isTextEmpty: Bool,
        shouldCenter: Bool,
        showDebugOverlays: Bool,
        placeholderOffset: CGFloat,
        bottomInsetExtra: CGFloat,
        topInsetExtra: CGFloat
    ) -> some View {
        let singleLineOffset = isSingleLine ? -bottomInsetExtra / 2 : 0
        let inputField = ZStack(alignment: .topLeading) {
            if isTextEmpty {
                Text("Message")
                    .foregroundStyle(.secondary)
                    .font(.body)
                    .padding(.top, 2 + placeholderOffset)
                    .transaction { transaction in
                        transaction.animation = nil
                    }
            }
            InputTextView(
                text: $text,
                measuredHeight: $measuredTextHeight,
                measuredLineCount: $measuredLineCount,
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
        inputField
            .frame(maxHeight: .infinity, alignment: shouldCenter ? .center : .top)
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
    private var pillHeightCancellable: AnyCancellable?
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
        pillHeightCancellable = geometryModel.$pillHeight
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
        let measuredFrameHeight = pillFrameInView.height
        let measuredHeight = geometryModel.pillHeight
        let pillHeight = max(
            fallbackHeight,
            max(measuredFrameHeight, measuredHeight)
        )
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
    @Binding var measuredLineCount: Int
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
        textView.onLineCountChange = { [weak coordinator = context.coordinator] lineCount in
            coordinator?.updateMeasuredLineCount(lineCount)
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
        uiView.onLineCountChange = { [weak coordinator = context.coordinator] lineCount in
            coordinator?.updateMeasuredLineCount(lineCount)
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
            if let measuringView = textView as? MeasuringTextView {
                let lineCount = measuringView.currentLineCount()
                if parent.measuredLineCount != lineCount {
                    parent.measuredLineCount = lineCount
                }
            }
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

        func updateMeasuredLineCount(_ lineCount: Int) {
            if parent.measuredLineCount != lineCount {
                parent.measuredLineCount = lineCount
            }
        }
    }
}

private final class MeasuringTextView: UITextView {
    var onHeightChange: ((CGFloat) -> Void)?
    var onLineCountChange: ((Int) -> Void)?
    private var lastMeasuredHeight: CGFloat = 0
    private var lastMeasuredLineCount: Int = 0

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
        let lineCount = max(1, measuredLineCount())
        if lineCount != lastMeasuredLineCount {
            lastMeasuredLineCount = lineCount
            onLineCountChange?(lineCount)
        }
    }

    func currentLineCount() -> Int {
        layoutManager.ensureLayout(for: textContainer)
        return measuredLineCount()
    }

    private func measuredLineCount() -> Int {
        let numberOfGlyphs = layoutManager.numberOfGlyphs
        guard numberOfGlyphs > 0 else { return 0 }
        var lineCount = 0
        var index = 0
        while index < numberOfGlyphs {
            var lineRange = NSRange()
            layoutManager.lineFragmentUsedRect(forGlyphAt: index, effectiveRange: &lineRange)
            index = NSMaxRange(lineRange)
            lineCount += 1
        }
        return lineCount
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
