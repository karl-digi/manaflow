import SwiftUI
import UIKit

private func log(_ message: String) {
    NSLog("[CMUX_CHAT_FIX1] MAIN %@", message)
}

struct ChatFix1MainView: View {
    let conversation: Conversation
    private let topShimHeight: CGFloat

    init(conversation: Conversation) {
        self.conversation = conversation
        self.topShimHeight = 1 / UIScreen.main.scale
    }

    var body: some View {
        VStack(spacing: 0) {
            Color.clear
                .frame(height: topShimHeight)
                .accessibilityHidden(true)
            Fix1MainViewController_Wrapper(conversation: conversation)
                .ignoresSafeArea()
        }
    }
}

private struct Fix1MainViewController_Wrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> Fix1MainViewController {
        Fix1MainViewController(messages: conversation.messages, titleText: conversation.name)
    }

    func updateUIViewController(_ uiViewController: Fix1MainViewController, context: Context) {}
}

private final class Fix1MainViewController: UIViewController, UIScrollViewDelegate {
    private var scrollView: UIScrollView!
    private var contentStack: UIStackView!
    private var inputBarVC: DebugInputBarViewController!

    private var messages: [Message]
    private var keyboardAnimator: UIViewPropertyAnimator?
    private var lastKeyboardHeight: CGFloat = 0
    private var inputBarBottomConstraint: NSLayoutConstraint!
    private var contentStackBottomConstraint: NSLayoutConstraint!
    private var lastTopLogSignature: String?
    private var headerContainer: UIView!
    private var backButton: UIButton!
    private var titleLabel: UILabel!

    private let titleText: String

    init(messages: [Message], titleText: String) {
        self.messages = messages
        self.titleText = titleText
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        setupScrollView()
        setupInputBar()
        setupHeaderOverlay()
        setupConstraints()
        populateMessages()
        setupKeyboardObservers()

        applyFix1()

        log("🚀 viewDidLoad complete")

        DispatchQueue.main.async {
            log("viewDidLoad - second async scrollToBottom")
            self.scrollToBottom(animated: false)
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        navigationController?.setNavigationBarHidden(false, animated: false)
    }

    private func applyFix1() {
        log("🔧 applyFix1 called")

        scrollView.contentInsetAdjustmentBehavior = .never
        contentStackBottomConstraint.constant = -8

        log("applyFix1 - before updateScrollViewInsets")
        log("  view.window: \(String(describing: view.window))")
        log("  view.safeAreaInsets: \(view.safeAreaInsets)")
        log("  inputBarVC.view.bounds: \(inputBarVC.view.bounds)")

        updateScrollViewInsets()
        view.layoutIfNeeded()

        log("applyFix1 - after layoutIfNeeded")
        log("  scrollView.contentInset: \(scrollView.contentInset)")
        log("  scrollView.contentSize: \(scrollView.contentSize)")
        log("  scrollView.bounds: \(scrollView.bounds)")
        logTopInsets(reason: "applyFix1-after-layout")

        DispatchQueue.main.async {
            log("applyFix1 - first async scrollToBottom")
            log("  scrollView.contentInset: \(self.scrollView.contentInset)")
            log("  scrollView.contentSize: \(self.scrollView.contentSize)")
            self.scrollToBottom(animated: false)
        }
    }

    private func setupKeyboardObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
    }

    @objc private func keyboardWillChange(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
              let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int else { return }

        let curve = UIView.AnimationCurve(rawValue: curveRaw) ?? .easeInOut
        let animationDuration = duration > 0 ? duration : 0.25
        let endFrameInView = view.convert(endFrame, from: nil)
        let keyboardOverlap = max(0, view.bounds.maxY - endFrameInView.minY)

        let safeBottom = view.window?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        let effectiveKeyboardHeight = keyboardOverlap > safeBottom ? keyboardOverlap - safeBottom : 0
        let delta = effectiveKeyboardHeight - lastKeyboardHeight

        lastKeyboardHeight = effectiveKeyboardHeight

        guard abs(delta) > 1 else { return }

        keyboardAnimator?.stopAnimation(true)

        let inputBarHeight = inputBarVC.view.bounds.height
        let newBottomInset = inputBarHeight + max(keyboardOverlap, safeBottom)
        let currentOffset = scrollView.contentOffset

        var targetOffsetY = currentOffset.y + delta
        let minY: CGFloat = 0
        let maxY = max(0, scrollView.contentSize.height - scrollView.bounds.height + newBottomInset)
        targetOffsetY = min(max(targetOffsetY, minY), maxY)

        keyboardAnimator = UIViewPropertyAnimator(duration: animationDuration, curve: curve) { [self] in
            inputBarBottomConstraint.constant = -max(keyboardOverlap, safeBottom)
            scrollView.contentInset.bottom = newBottomInset
            scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset
            scrollView.contentOffset.y = targetOffsetY
            view.layoutIfNeeded()
        }
        keyboardAnimator?.startAnimation()
    }

    private func setupScrollView() {
        scrollView = UIScrollView()
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        scrollView.showsVerticalScrollIndicator = false
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.delegate = self

        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        scrollView.addGestureRecognizer(tap)

        view.addSubview(scrollView)

        contentStack = UIStackView()
        contentStack.axis = .vertical
        contentStack.spacing = 8
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)
    }

    private func setupInputBar() {
        inputBarVC = DebugInputBarViewController()
        inputBarVC.view.translatesAutoresizingMaskIntoConstraints = false
        inputBarVC.onSend = { [weak self] in
            self?.sendMessage()
        }

        addChild(inputBarVC)
        view.addSubview(inputBarVC.view)
        inputBarVC.didMove(toParent: self)
    }

    private func setupHeaderOverlay() {
        headerContainer = UIView()
        headerContainer.translatesAutoresizingMaskIntoConstraints = false
        headerContainer.backgroundColor = .clear
        view.addSubview(headerContainer)

        backButton = UIButton(type: .system)
        backButton.translatesAutoresizingMaskIntoConstraints = false
        let chevron = UIImage(systemName: "chevron.left")
        backButton.setImage(chevron, for: .normal)
        backButton.tintColor = .label
        backButton.addTarget(self, action: #selector(handleBackButton), for: .touchUpInside)
        backButton.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.7)
        backButton.layer.cornerRadius = 18
        backButton.clipsToBounds = true
        headerContainer.addSubview(backButton)

        titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = titleText
        titleLabel.font = UIFont.preferredFont(forTextStyle: .headline)
        titleLabel.textColor = .label
        headerContainer.addSubview(titleLabel)
    }

    private func setupConstraints() {
        inputBarBottomConstraint = inputBarVC.view.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: 0)
        contentStackBottomConstraint = contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -16),
            contentStackBottomConstraint,
            contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -32),

            inputBarVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarBottomConstraint,

            headerContainer.topAnchor.constraint(equalTo: view.topAnchor),
            headerContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            headerContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            backButton.leadingAnchor.constraint(equalTo: headerContainer.leadingAnchor, constant: 16),
            backButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            backButton.widthAnchor.constraint(equalToConstant: 36),
            backButton.heightAnchor.constraint(equalToConstant: 36),

            titleLabel.centerXAnchor.constraint(equalTo: headerContainer.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: backButton.centerYAnchor),

            headerContainer.bottomAnchor.constraint(equalTo: backButton.bottomAnchor, constant: 8)
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        log("viewDidLayoutSubviews - lastKeyboardHeight: \(lastKeyboardHeight)")
        log("  view.window: \(String(describing: view.window))")
        log("  inputBarVC.view.bounds: \(inputBarVC.view.bounds)")
        if lastKeyboardHeight == 0 {
            let safeBottom = view.window?.safeAreaInsets.bottom ?? 0
            log("  setting inputBarBottomConstraint to: \(-safeBottom)")
            inputBarBottomConstraint.constant = -safeBottom
            updateScrollViewInsets()
        }
        logTopInsets(reason: "viewDidLayoutSubviews")
    }

    private func updateScrollViewInsets() {
        let inputBarHeight = inputBarVC.view.bounds.height
        let safeBottom = view.window?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        let newBottomInset = inputBarHeight + safeBottom

        log("updateScrollViewInsets:")
        log("  inputBarHeight: \(inputBarHeight)")
        log("  safeBottom: \(safeBottom)")
        log("  newBottomInset: \(newBottomInset)")

        scrollView.contentInset.bottom = newBottomInset
        scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset
    }

    private func logTopInsets(reason: String) {
        let safeTop = view.window?.safeAreaInsets.top ?? view.safeAreaInsets.top
        let scrollInsetTop = scrollView.contentInset.top
        let adjustedTop = scrollView.adjustedContentInset.top
        let scrollFrameMinY = scrollView.frame.minY
        let scrollBoundsHeight = scrollView.bounds.height
        let offsetY = scrollView.contentOffset.y
        let signature = String(
            format: "safeTop=%.1f insetTop=%.1f adjustedTop=%.1f scrollFrameMinY=%.1f boundsH=%.1f offsetY=%.1f",
            safeTop,
            scrollInsetTop,
            adjustedTop,
            scrollFrameMinY,
            scrollBoundsHeight,
            offsetY
        )
        if signature != lastTopLogSignature {
            log("CMUX_CHAT_TOP \(reason) \(signature)")
            lastTopLogSignature = signature
        }
    }

    private func populateMessages() {
        for (index, message) in messages.enumerated() {
            let bubble = MessageBubble(
                message: message,
                showTail: index == messages.count - 1,
                showTimestamp: index == 0
            )
            let host = UIHostingController(rootView: bubble)
            host.view.backgroundColor = .clear
            host.view.translatesAutoresizingMaskIntoConstraints = false

            addChild(host)
            contentStack.addArrangedSubview(host.view)
            host.didMove(toParent: self)
        }
    }

    private func scrollToBottom(animated: Bool) {
        let visibleHeight = scrollView.bounds.height - scrollView.contentInset.bottom
        let bottomOffset = CGPoint(
            x: 0,
            y: max(0, scrollView.contentSize.height - visibleHeight)
        )
        log("scrollToBottom:")
        log("  scrollView.bounds: \(scrollView.bounds)")
        log("  scrollView.contentInset.bottom: \(scrollView.contentInset.bottom)")
        log("  visibleHeight: \(visibleHeight)")
        log("  scrollView.contentSize: \(scrollView.contentSize)")
        log("  bottomOffset: \(bottomOffset)")
        scrollView.setContentOffset(bottomOffset, animated: animated)
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }

    @objc private func handleBackButton() {
        if let navigationController {
            navigationController.popViewController(animated: true)
        } else {
            dismiss(animated: true)
        }
    }

    private func sendMessage() {
        guard !inputBarVC.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        let message = Message(content: inputBarVC.text, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        inputBarVC.clearText()

        let bubble = MessageBubble(message: message, showTail: true, showTimestamp: false)
        let host = UIHostingController(rootView: bubble)
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false

        addChild(host)
        contentStack.addArrangedSubview(host.view)
        host.didMove(toParent: self)

        DispatchQueue.main.async {
            self.scrollToBottom(animated: true)
        }
    }
}
