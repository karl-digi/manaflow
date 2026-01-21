import XCTest

final class MultilineInputUITests: XCTestCase {
    private let conversationName = "Claude"
    private let centerTolerance: CGFloat = 3.5
    private let maxPillHeight: CGFloat = 120
    private let minHeightGrowth: CGFloat = 18
    private let minReturnGrowth: CGFloat = 12
    private let bottomEdgeTolerance: CGFloat = 1
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

        let pill = waitForInputPill(app: app)
        let bottomEdge = waitForInputPillBottomEdge(app: app)

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

        let pill = waitForInputPill(app: app)
        let bottomEdge = waitForInputPillBottomEdge(app: app)

        let input = waitForInputField(app: app)
        focusInput(app: app, pill: pill, input: input)
        clearInput(app: app, input: input)

        let baselinePillHeight = pill.frame.height
        let baselineInputHeight = input.frame.height

        setMultilineText(
            app: app,
            pill: pill,
            input: input,
            text: "Line 1\nLine 2\nLine 3"
        )
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
        waitForInputWithinPill(pill: pill, input: input, timeout: 2)

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

    func testPillExpandsForReturnsOnlyAndShowsSend() {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_DEBUG_AUTOFOCUS"] = "0"
        app.launchEnvironment["CMUX_UITEST_MOCK_DATA"] = "1"
        app.launch()

        ensureSignedIn(app: app)
        waitForConversationList(app: app)
        ensureConversationVisible(app: app, name: conversationName)
        openConversation(app: app, name: conversationName)

        let pill = waitForInputPill(app: app)
        let bottomEdge = waitForInputPillBottomEdge(app: app)

        let input = waitForInputField(app: app)
        focusInput(app: app, pill: pill, input: input)
        clearInput(app: app, input: input)

        let baselinePillHeight = pill.frame.height
        let baselineInputHeight = input.frame.height

        typeText(app: app, input: input, text: "\n\n")
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))

        let sendButton = app.buttons["chat.sendButton"]
        XCTAssertTrue(
            sendButton.waitForExistence(timeout: 2),
            "Expected send button to appear for whitespace input"
        )

        let placeholder = app.staticTexts["Message"]
        XCTAssertFalse(
            placeholder.exists,
            "Expected placeholder to hide when whitespace is entered"
        )

        let expandedPillHeight = waitForHeightIncrease(
            element: pill,
            baseline: baselinePillHeight,
            minGrowth: minReturnGrowth,
            timeout: 2
        )
        let expandedInputHeight = waitForHeightIncrease(
            element: input,
            baseline: baselineInputHeight,
            minGrowth: minReturnGrowth,
            timeout: 2
        )

        XCTAssertGreaterThan(
            expandedPillHeight,
            baselinePillHeight + minReturnGrowth,
            "Expected pill to grow for return-only input"
        )
        XCTAssertGreaterThan(
            expandedInputHeight,
            baselineInputHeight + minReturnGrowth,
            "Expected input field to grow for return-only input"
        )
    }

    func testPillBottomEdgeStaysFixedWhenGrowing() {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_DEBUG_AUTOFOCUS"] = "0"
        app.launchEnvironment["CMUX_UITEST_MOCK_DATA"] = "1"
        app.launch()

        ensureSignedIn(app: app)
        waitForConversationList(app: app)
        ensureConversationVisible(app: app, name: conversationName)
        openConversation(app: app, name: conversationName)

        let pill = waitForInputPill(app: app)
        let bottomEdge = waitForInputPillBottomEdge(app: app)

        let input = waitForInputField(app: app)
        focusInput(app: app, pill: pill, input: input)
        clearInput(app: app, input: input)

        let baselineBottom = waitForStablePillBottom(
            bottomEdge: bottomEdge,
            tolerance: bottomEdgeTolerance,
            stableSamples: 3,
            timeout: 2
        )
        let baselineHeight = pill.frame.height

        typeText(app: app, input: input, text: "\n\n")
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))

        assertPillBottomStableDuringGrowth(
            pillFrame: pill,
            bottomEdge: bottomEdge,
            baselineBottom: baselineBottom,
            baselineHeight: baselineHeight,
            minGrowth: minReturnGrowth,
            timeout: 1.4
        )
    }

    func testPlaceholderResetsAfterMultiline() {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_DEBUG_AUTOFOCUS"] = "0"
        app.launchEnvironment["CMUX_UITEST_MOCK_DATA"] = "1"
        app.launch()

        ensureSignedIn(app: app)
        waitForConversationList(app: app)
        ensureConversationVisible(app: app, name: conversationName)
        openConversation(app: app, name: conversationName)

        let pill = waitForInputPill(app: app)

        let input = waitForInputField(app: app)
        focusInput(app: app, pill: pill, input: input)
        clearInput(app: app, input: input)

        assertInputCenterAligned(pill: pill, input: input, context: "placeholder baseline")
        let baselinePillHeight = pill.frame.height
        let baselineInputHeight = input.frame.height

        setMultilineText(
            app: app,
            pill: pill,
            input: input,
            text: "Line 1\nLine 2\nLine 3"
        )
        _ = waitForHeightIncrease(
            element: pill,
            baseline: baselinePillHeight,
            minGrowth: minHeightGrowth,
            timeout: 2
        )
        _ = waitForHeightIncrease(
            element: input,
            baseline: baselineInputHeight,
            minGrowth: minHeightGrowth,
            timeout: 2
        )

        clearInput(app: app, input: input)
        let reducedPillHeight = waitForHeightDecrease(
            element: pill,
            baseline: baselinePillHeight,
            maxGrowth: frameTolerance,
            timeout: 3
        )
        let reducedInputHeight = waitForHeightDecrease(
            element: input,
            baseline: baselineInputHeight,
            maxGrowth: frameTolerance,
            timeout: 3
        )
        waitForInputWithinPill(pill: pill, input: input, timeout: 2)
        XCTAssertLessThanOrEqual(
            reducedPillHeight,
            baselinePillHeight + frameTolerance,
            "Expected pill height to return to single-line baseline"
        )
        XCTAssertLessThanOrEqual(
            reducedInputHeight,
            baselineInputHeight + frameTolerance,
            "Expected input height to return to single-line baseline"
        )
        assertInputCenterAligned(pill: pill, input: input, context: "placeholder after multiline")
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

    private func waitForInputPill(app: XCUIApplication) -> XCUIElement {
        let framePill = app.otherElements["chat.inputPillFrame"]
        if framePill.waitForExistence(timeout: 6) {
            return framePill
        }
        let pill = app.otherElements["chat.inputPill"]
        XCTAssertTrue(pill.waitForExistence(timeout: 6))
        return pill
    }

    private func waitForInputPillBottomEdge(app: XCUIApplication) -> XCUIElement {
        let bottomEdge = app.otherElements["chat.inputPillBottomEdge"]
        if bottomEdge.waitForExistence(timeout: 6) {
            return bottomEdge
        }
        return waitForInputPill(app: app)
    }

    private func clearInput(app: XCUIApplication, input: XCUIElement) {
        if (input.elementType == .textView || input.elementType == .textField) && input.isHittable {
            input.tap()
        }
        if let value = input.value as? String {
            if value == "Message" || value.isEmpty {
                return
            }
            let deleteString = String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count)
            app.typeText(deleteString)
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
            if let remaining = readInputValue(app: app, input: input), !remaining.isEmpty {
                let debugClearButton = app.buttons["chat.debugClearInput"]
                if debugClearButton.waitForExistence(timeout: 1) {
                    debugClearButton.tap()
                    RunLoop.current.run(until: Date().addingTimeInterval(0.2))
                    return
                }
                input.press(forDuration: 1.1)
                let selectAll = app.menuItems["Select All"]
                if selectAll.waitForExistence(timeout: 1) {
                    selectAll.tap()
                    app.typeText(XCUIKeyboardKey.delete.rawValue)
                }
            }
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

    private func setMultilineText(
        app: XCUIApplication,
        pill: XCUIElement,
        input: XCUIElement,
        text: String
    ) {
        typeText(app: app, input: input, text: text)
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        if let value = readInputValue(app: app, input: input), value.contains("Line 2") {
            return
        }
        let debugMultilineButton = app.buttons["chat.debugSetMultiline"]
        if debugMultilineButton.waitForExistence(timeout: 2) {
            debugMultilineButton.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
            focusInput(app: app, pill: pill, input: input)
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

    private func waitForHeightDecrease(
        element: XCUIElement,
        baseline: CGFloat,
        maxGrowth: CGFloat,
        timeout: TimeInterval
    ) -> CGFloat {
        let deadline = Date().addingTimeInterval(timeout)
        var currentHeight = element.frame.height
        while Date() < deadline {
            currentHeight = element.frame.height
            if currentHeight <= baseline + maxGrowth {
                return currentHeight
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return currentHeight
    }

    private func waitForInputWithinPill(
        pill: XCUIElement,
        input: XCUIElement,
        timeout: TimeInterval
    ) {
        let deadline = Date().addingTimeInterval(timeout)
        var consecutiveHits = 0
        while Date() < deadline {
            let pillFrame = pill.frame
            let inputFrame = input.frame
            let withinTop = inputFrame.minY >= pillFrame.minY - frameTolerance
            let withinBottom = inputFrame.maxY <= pillFrame.maxY + frameTolerance
            if withinTop && withinBottom {
                consecutiveHits += 1
                if consecutiveHits >= 2 {
                    return
                }
            } else {
                consecutiveHits = 0
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
    }

    private func assertPillBottomStableDuringGrowth(
        pillFrame: XCUIElement,
        bottomEdge: XCUIElement,
        baselineBottom: CGFloat,
        baselineHeight: CGFloat,
        minGrowth: CGFloat,
        timeout: TimeInterval
    ) {
        let deadline = Date().addingTimeInterval(timeout)
        var maxDeviation: CGFloat = 0
        var maxHeight = baselineHeight
        while Date() < deadline {
            let bottom = bottomEdge.frame.maxY
            let height = pillFrame.frame.height
            maxDeviation = max(maxDeviation, abs(bottom - baselineBottom))
            maxHeight = max(maxHeight, height)
            RunLoop.current.run(until: Date().addingTimeInterval(0.016))
        }
        XCTAssertGreaterThan(
            maxHeight,
            baselineHeight + minGrowth,
            "Expected pill to grow while monitoring bottom edge"
        )
        XCTAssertLessThanOrEqual(
            maxDeviation,
            bottomEdgeTolerance,
            "Pill bottom should stay fixed while growing (max deviation \(maxDeviation))"
        )
    }

    private func waitForStablePillBottom(
        bottomEdge: XCUIElement,
        tolerance: CGFloat,
        stableSamples: Int,
        timeout: TimeInterval
    ) -> CGFloat {
        let deadline = Date().addingTimeInterval(timeout)
        var lastBottom = bottomEdge.frame.maxY
        var stableCount = 0
        while Date() < deadline {
            let currentBottom = bottomEdge.frame.maxY
            if abs(currentBottom - lastBottom) <= tolerance {
                stableCount += 1
                if stableCount >= stableSamples {
                    return currentBottom
                }
            } else {
                stableCount = 0
                lastBottom = currentBottom
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.016))
        }
        return bottomEdge.frame.maxY
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
