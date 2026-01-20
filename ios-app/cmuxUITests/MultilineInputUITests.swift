import XCTest

final class MultilineInputUITests: XCTestCase {
    private let conversationName = "Claude"
    private let centerTolerance: CGFloat = 3.5
    private let maxPillHeight: CGFloat = 120
    private let minHeightGrowth: CGFloat = 18
    private let frameTolerance: CGFloat = 3.5

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testInputCentersPlaceholderAndSingleLineText() {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_DEBUG_AUTOFOCUS"] = "0"
        app.launchEnvironment["CMUX_UITEST_MOCK_DATA"] = "1"
        app.launch()

        ensureSignedIn(app: app)
        waitForConversationList(app: app)
        ensureConversationVisible(app: app, name: conversationName)
        openConversation(app: app, name: conversationName)

        let pill = app.otherElements["chat.inputPill"]
        XCTAssertTrue(pill.waitForExistence(timeout: 6))

        let input = waitForInputField(app: app)
        focusInput(app: app, pill: pill, input: input)
        clearInput(app: app, input: input)

        assertInputCenterAligned(pill: pill, input: input, context: "placeholder")

        typeText(app: app, input: input, text: "Hello")
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))

        if let value = readInputValue(app: app, input: input) {
            XCTAssertTrue(value.contains("Hello"), "Expected input to contain typed text")
        }
        assertInputCenterAligned(pill: pill, input: input, context: "single-line text")
    }

    func testInputExpandsForMultilineText() {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_DEBUG_AUTOFOCUS"] = "0"
        app.launchEnvironment["CMUX_UITEST_MOCK_DATA"] = "1"
        app.launch()

        ensureSignedIn(app: app)
        waitForConversationList(app: app)
        ensureConversationVisible(app: app, name: conversationName)
        openConversation(app: app, name: conversationName)

        let pill = app.otherElements["chat.inputPill"]
        XCTAssertTrue(pill.waitForExistence(timeout: 6))

        let input = waitForInputField(app: app)
        focusInput(app: app, pill: pill, input: input)
        clearInput(app: app, input: input)

        let baselinePillHeight = pill.frame.height
        let baselineInputHeight = input.frame.height

        let debugMultilineButton = app.buttons["chat.debugSetMultiline"]
        if debugMultilineButton.waitForExistence(timeout: 2) {
            debugMultilineButton.tap()
        } else {
            typeText(app: app, input: input, text: "Line 1\nLine 2\nLine 3")
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))

        if let value = readInputValue(app: app, input: input) {
            XCTAssertTrue(value.contains("Line 1"), "Expected multiline text to include first line")
        }

        let expandedPillHeight = waitForHeightIncrease(
            element: pill,
            baseline: baselinePillHeight,
            minGrowth: minHeightGrowth,
            timeout: 2
        )
        let expandedInputHeight = waitForHeightIncrease(
            element: input,
            baseline: baselineInputHeight,
            minGrowth: minHeightGrowth,
            timeout: 2
        )

        XCTAssertGreaterThan(
            expandedPillHeight,
            baselinePillHeight + minHeightGrowth,
            "Expected pill to grow for multiline input"
        )
        XCTAssertGreaterThan(
            expandedInputHeight,
            baselineInputHeight + minHeightGrowth,
            "Expected input field to grow for multiline input"
        )
        XCTAssertLessThanOrEqual(
            expandedPillHeight,
            maxPillHeight + 4,
            "Pill height should respect max height"
        )

        let pillFrame = pill.frame
        let inputFrame = input.frame
        XCTAssertGreaterThanOrEqual(
            inputFrame.minY,
            pillFrame.minY - frameTolerance,
            "Input text should stay within pill bounds (top)"
        )
        XCTAssertLessThanOrEqual(
            inputFrame.maxY,
            pillFrame.maxY + frameTolerance,
            "Input text should stay within pill bounds (bottom)"
        )
    }

    private func assertInputCenterAligned(pill: XCUIElement, input: XCUIElement, context: String) {
        let pillCenter = pill.frame.midY
        let inputCenter = input.frame.midY
        let delta = abs(pillCenter - inputCenter)
        XCTAssertLessThanOrEqual(
            delta,
            centerTolerance,
            "Input center misaligned for \(context): \(delta)"
        )
    }

    private func waitForInputField(app: XCUIApplication) -> XCUIElement {
        let textView = app.textViews["chat.inputField"]
        if textView.waitForExistence(timeout: 4) {
            return textView
        }
        let textField = app.textFields["chat.inputField"]
        if textField.waitForExistence(timeout: 4) {
            return textField
        }
        let placeholderField = app.textFields["Message"]
        if placeholderField.waitForExistence(timeout: 2) {
            return placeholderField
        }
        let placeholderView = app.textViews["Message"]
        if placeholderView.waitForExistence(timeout: 2) {
            return placeholderView
        }
        let firstTextView = app.textViews.firstMatch
        if firstTextView.waitForExistence(timeout: 2) {
            return firstTextView
        }
        let firstTextField = app.textFields.firstMatch
        if firstTextField.waitForExistence(timeout: 2) {
            return firstTextField
        }
        let fallback = app.otherElements["chat.inputField"]
        XCTAssertTrue(fallback.waitForExistence(timeout: 2))
        return fallback
    }

    private func clearInput(app: XCUIApplication, input: XCUIElement) {
        if let value = input.value as? String {
            if value == "Message" || value.isEmpty {
                return
            }
            let deleteString = String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count)
            app.typeText(deleteString)
        }
    }

    private func focusInput(app: XCUIApplication, pill: XCUIElement, input: XCUIElement) {
        if input.elementType == .textView || input.elementType == .textField {
            input.tap()
        } else {
            pill.tap()
        }
    }

    private func typeText(app: XCUIApplication, input: XCUIElement, text: String) {
        if input.elementType == .textView || input.elementType == .textField {
            input.typeText(text)
        } else {
            app.typeText(text)
        }
    }

    private func readInputValue(app: XCUIApplication, input: XCUIElement) -> String? {
        let fallback = app.otherElements["chat.inputValue"].firstMatch
        if fallback.exists, let value = fallback.value as? String, !value.isEmpty {
            return value
        }
        if let value = input.value as? String, !value.isEmpty, value != "Message" {
            return value
        }
        if !input.label.isEmpty {
            return input.label
        }
        return nil
    }

    private func waitForHeightIncrease(
        element: XCUIElement,
        baseline: CGFloat,
        minGrowth: CGFloat,
        timeout: TimeInterval
    ) -> CGFloat {
        let deadline = Date().addingTimeInterval(timeout)
        var currentHeight = element.frame.height
        while Date() < deadline {
            currentHeight = element.frame.height
            if currentHeight > baseline + minGrowth {
                return currentHeight
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return currentHeight
    }

    private func openConversation(app: XCUIApplication, name: String) {
        let conversation = app.staticTexts[name]
        if !conversation.waitForExistence(timeout: 6) {
            ensureConversationVisible(app: app, name: name)
        }
        XCTAssertTrue(conversation.waitForExistence(timeout: 6))
        conversation.tap()
    }

    private func ensureConversationVisible(app: XCUIApplication, name: String) {
        let list = app.tables.element(boundBy: 0)
        let conversation = app.staticTexts[name]
        let maxSwipes = 6
        var attempt = 0
        while attempt < maxSwipes && !conversation.exists {
            if list.exists {
                list.swipeUp()
            } else {
                app.swipeUp()
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
            attempt += 1
        }
    }

    private func ensureSignedIn(app: XCUIApplication) {
        let emailField = app.textFields["Email"]
        if emailField.waitForExistence(timeout: 2) {
            emailField.tap()
            emailField.typeText("42")
            let continueButton = app.buttons["Continue"]
            if continueButton.exists {
                continueButton.tap()
            }
        }
    }

    private func waitForConversationList(app: XCUIApplication) {
        let navBar = app.navigationBars["Tasks"]
        if navBar.waitForExistence(timeout: 10) {
            return
        }
        let list = app.tables.element(boundBy: 0)
        _ = list.waitForExistence(timeout: 6)
    }
}
