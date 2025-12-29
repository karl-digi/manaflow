import SwiftUI
import UIKit

/// Container that provides Telegram-style keyboard handling for chat UIs.
/// - Input bar tracks keyboard via keyboardLayoutGuide
/// - Messages scroll view manages its own bottom insets
/// - When user is at bottom, they stay pinned there during keyboard transitions
struct ChatKeyboardContainer<Messages: View, InputBar: View>: UIViewControllerRepresentable {
    let messages: Messages
    let inputBar: InputBar
    @Binding var scrollToBottomTrigger: Int

    init(
        scrollToBottomTrigger: Binding<Int>,
        @ViewBuilder messages: () -> Messages,
        @ViewBuilder inputBar: () -> InputBar
    ) {
        self._scrollToBottomTrigger = scrollToBottomTrigger
        self.messages = messages()
        self.inputBar = inputBar()
    }

    func makeUIViewController(context: Context) -> ChatKeyboardViewController<Messages, InputBar> {
        ChatKeyboardViewController(messages: messages, inputBar: inputBar)
    }

    func updateUIViewController(_ controller: ChatKeyboardViewController<Messages, InputBar>, context: Context) {
        controller.updateMessages(messages)
        controller.updateInputBar(inputBar)

        // Check if scroll trigger changed
        if scrollToBottomTrigger != context.coordinator.lastScrollTrigger {
            context.coordinator.lastScrollTrigger = scrollToBottomTrigger
            controller.scrollToBottom(animated: true)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator {
        var lastScrollTrigger: Int = 0
    }
}

final class ChatKeyboardViewController<Messages: View, InputBar: View>: UIViewController, UIScrollViewDelegate {
    // MARK: - Views
    private var scrollView: UIScrollView!
    private var messagesHost: UIHostingController<Messages>!
    private var inputBarHost: UIHostingController<InputBar>!

    // MARK: - Keyboard state
    private var keyboardAnimator: UIViewPropertyAnimator?
    private var keyboardOverlap: CGFloat = 0

    // MARK: - Interactive tracking
    private var displayLink: CADisplayLink?
    private var isInteractivelyDismissing = false

    // MARK: - Init
    init(messages: Messages, inputBar: InputBar) {
        super.init(nibName: nil, bundle: nil)
        self.messagesHost = UIHostingController(rootView: messages)
        self.inputBarHost = UIHostingController(rootView: inputBar)
    }

    required init?(coder: NSCoder) { fatalError() }

    deinit {
        displayLink?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Lifecycle
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        setupScrollView()
        setupMessagesHost()
        setupInputBarHost()
        setupKeyboardObservers()
        setupTapToDismiss()
    }

    private func setupScrollView() {
        scrollView = UIScrollView()
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.delegate = self

        view.addSubview(scrollView)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func setupMessagesHost() {
        messagesHost.view.backgroundColor = .clear
        messagesHost.view.translatesAutoresizingMaskIntoConstraints = false
        // Disable safe area on the hosting controller so our content goes edge-to-edge
        messagesHost.safeAreaRegions = []

        addChild(messagesHost)
        scrollView.addSubview(messagesHost.view)
        messagesHost.didMove(toParent: self)

        NSLayoutConstraint.activate([
            messagesHost.view.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            messagesHost.view.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            messagesHost.view.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            messagesHost.view.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            messagesHost.view.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor)
        ])
    }

    private func setupInputBarHost() {
        inputBarHost.view.backgroundColor = .clear
        inputBarHost.view.translatesAutoresizingMaskIntoConstraints = false
        inputBarHost.safeAreaRegions = []

        addChild(inputBarHost)
        view.addSubview(inputBarHost.view) // Above scroll view
        inputBarHost.didMove(toParent: self)

        NSLayoutConstraint.activate([
            inputBarHost.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarHost.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            // Track keyboard via keyboardLayoutGuide
            inputBarHost.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
    }

    private func setupTapToDismiss() {
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        tap.cancelsTouchesInView = false
        scrollView.addGestureRecognizer(tap)
    }

    @objc private func handleTap() {
        view.endEditing(true)
    }

    private func setupKeyboardObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )

        // Display link for tracking input bar during interactive dismiss
        displayLink = CADisplayLink(target: self, selector: #selector(trackInputBarFrame))
        displayLink?.add(to: .main, forMode: .common)
    }

    @objc private func trackInputBarFrame() {
        // Always sync scroll inset to where input bar actually is
        // This handles interactive keyboard dismiss perfectly
        let inputBarHeight = inputBarHost.view.bounds.height
        guard inputBarHeight > 0 else { return }

        // Where is the input bar's top edge?
        let inputBarTop = inputBarHost.view.frame.minY
        let viewHeight = view.bounds.height

        // How much space is below the input bar (keyboard)?
        let spaceBelow = viewHeight - inputBarTop - inputBarHeight
        let keyboardHeight = max(0, spaceBelow - view.safeAreaInsets.bottom)

        let newBottomInset = keyboardHeight + inputBarHeight
        let currentInset = scrollView.contentInset.bottom

        // Only update if changed significantly (avoid jitter)
        if abs(newBottomInset - currentInset) > 0.5 {
            let wasNearBottom = isNearBottom()
            let delta = newBottomInset - currentInset

            scrollView.contentInset.bottom = newBottomInset
            scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset

            // Keep pinned to bottom during interactive tracking
            if wasNearBottom && isInteractivelyDismissing {
                shiftContentOffset(by: delta)
            }
        }
    }

    // MARK: - Keyboard handling
    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
        guard let info = KeyboardInfo(notification, in: view) else { return }

        // Short duration = interactive dismiss, let display link handle it
        if info.duration < 0.05 {
            isInteractivelyDismissing = true
            return
        }

        isInteractivelyDismissing = false
        applyKeyboard(overlap: info.overlap, duration: info.duration, curve: info.curve)
    }

    private func applyKeyboard(overlap: CGFloat, duration: TimeInterval, curve: UIView.AnimationCurve) {
        let newKeyboardOverlap = max(0, overlap - view.safeAreaInsets.bottom)
        let wasNearBottom = isNearBottom()

        // Force layout to get input bar height
        inputBarHost.view.layoutIfNeeded()
        let inputBarHeight = inputBarHost.view.bounds.height

        keyboardAnimator?.stopAnimation(true)

        keyboardAnimator = UIViewPropertyAnimator(duration: duration, curve: curve) { [weak self] in
            guard let self else { return }

            let newBottomInset = newKeyboardOverlap + inputBarHeight
            let oldBottomInset = self.scrollView.contentInset.bottom
            let delta = newBottomInset - oldBottomInset

            self.keyboardOverlap = newKeyboardOverlap
            self.scrollView.contentInset.bottom = newBottomInset
            self.scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset

            // Telegram-like: keep user pinned to bottom
            if wasNearBottom {
                self.shiftContentOffset(by: delta)
            }

            self.view.layoutIfNeeded()
        }

        keyboardAnimator?.startAnimation()
    }

    private func isNearBottom(threshold: CGFloat = 24) -> Bool {
        let visibleBottom = scrollView.contentOffset.y + scrollView.bounds.height - scrollView.adjustedContentInset.bottom
        return (scrollView.contentSize.height - visibleBottom) < threshold
    }

    private func shiftContentOffset(by delta: CGFloat) {
        guard delta != 0 else { return }

        var offset = scrollView.contentOffset
        offset.y += delta

        // Clamp to valid range
        let minY = -scrollView.adjustedContentInset.top
        let maxY = max(minY, scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom)
        offset.y = min(max(offset.y, minY), maxY)

        scrollView.setContentOffset(offset, animated: false)
    }

    // MARK: - Content updates
    func updateMessages(_ messages: Messages) {
        messagesHost.rootView = messages
    }

    func updateInputBar(_ inputBar: InputBar) {
        inputBarHost.rootView = inputBar
    }

    func scrollToBottom(animated: Bool) {
        // Need to let layout happen first
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.messagesHost.view.layoutIfNeeded()

            let maxY = max(0, self.scrollView.contentSize.height - self.scrollView.bounds.height + self.scrollView.contentInset.bottom)
            self.scrollView.setContentOffset(CGPoint(x: 0, y: maxY), animated: animated)
        }
    }

    // MARK: - Layout
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()

        // Initial setup of bottom inset (before any keyboard activity)
        let inputBarHeight = inputBarHost.view.bounds.height
        let expectedInset = keyboardOverlap + inputBarHeight

        if scrollView.contentInset.bottom == 0 && inputBarHeight > 0 {
            scrollView.contentInset.bottom = expectedInset
            scrollView.verticalScrollIndicatorInsets.bottom = expectedInset

            // Initial scroll to bottom
            let maxY = max(0, scrollView.contentSize.height - scrollView.bounds.height + expectedInset)
            scrollView.setContentOffset(CGPoint(x: 0, y: maxY), animated: false)
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        // Update top inset to account for navigation bar
        scrollView.contentInset.top = view.safeAreaInsets.top
        scrollView.verticalScrollIndicatorInsets.top = view.safeAreaInsets.top
    }

    // MARK: - UIScrollViewDelegate

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        // User started dragging - might be interactive keyboard dismiss
        isInteractivelyDismissing = true
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate {
            isInteractivelyDismissing = false
        }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        isInteractivelyDismissing = false
    }
}

// MARK: - Keyboard Info

private struct KeyboardInfo {
    let overlap: CGFloat
    let duration: TimeInterval
    let curve: UIView.AnimationCurve

    init?(_ notification: Notification, in view: UIView) {
        guard let userInfo = notification.userInfo else { return nil }

        duration = (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25

        let curveRaw = (userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int)
            ?? UIView.AnimationCurve.easeInOut.rawValue
        curve = UIView.AnimationCurve(rawValue: curveRaw) ?? .easeInOut

        let endFrameScreen = (userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect) ?? .zero
        let endFrame = view.convert(endFrameScreen, from: nil)

        overlap = view.bounds.intersection(endFrame).height
    }
}
