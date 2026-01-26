import XCTest

final class MessagePositionUITests: XCTestCase {
    private let yTolerance: CGFloat = 1.5
    private let gapTolerance: CGFloat = 2.5
    private let openOverlapMinDelta: CGFloat = 120
    private let minExpandedPillHeight: CGFloat = 56
    private let frameStabilityTolerance: CGFloat = 0.5
    private let frameSampleInterval: TimeInterval = 0.016

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testLastAssistantMessageBottomStableAfterKeyboardCycle() {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_DEBUG_AUTOFOCUS"] = "0"
        app.launchEnvironment["CMUX_UITEST_CHAT_VIEW"] = "1"
        app.launchEnvironment["CMUX_UITEST_CONVERSATION_ID"] = "uitest_conversation_claude"
        app.launchEnvironment["CMUX_UITEST_PROVIDER_ID"] = "claude"
        app.launchEnvironment["CMUX_UITEST_MOCK_DATA"] = "1"
        app.launchEnvironment["CMUX_UITEST_MESSAGE_COUNT"] = "90"
        app.launchEnvironment["CMUX_UITEST_ENDS_WITH_USER"] = "1"
        app.launchEnvironment["CMUX_UITEST_SCROLL_FRACTION"] = "1"
        app.launchEnvironment["CMUX_UITEST_TRACK_MESSAGE_POS"] = "1"
        app.launchEnvironment["CMUX_UITEST_BAR_Y_OFFSET"] = "34"
        app.launchEnvironment["CMUX_UITEST_INPUT_TEXT"] = "Line 1\\nLine 2\\nLine 3"
        if ProcessInfo.processInfo.environment["SIMULATOR_UDID"] != nil {
            app.launchEnvironment["CMUX_UITEST_FAKE_KEYBOARD"] = "1"
        }
        app.launch()

        waitForMessages(app: app)

        let marker = app.otherElements["chat.lastAssistantTextBottom"]
        XCTAssertTrue(marker.waitForExistence(timeout: 8))
        let pill = app.otherElements["chat.inputPillFrame"]
        XCTAssertTrue(pill.waitForExistence(timeout: 8))
        let insetMarker = app.otherElements["chat.bottomInsetValue"]
        XCTAssertTrue(insetMarker.waitForExistence(timeout: 8))
        let overlapMarker = app.otherElements["chat.keyboardOverlapValue"]
        XCTAssertTrue(overlapMarker.waitForExistence(timeout: 8))
        waitForScrollSettle()

        let focusButton = app.buttons["chat.keyboard.focus"]
        XCTAssertTrue(focusButton.waitForExistence(timeout: 4))
        let dismissButton = app.buttons["chat.keyboard.dismiss"]
        XCTAssertTrue(dismissButton.waitForExistence(timeout: 4))
        let pillHeightMarker = app.otherElements["chat.pillHeightValue"]
        XCTAssertTrue(pillHeightMarker.waitForExistence(timeout: 4))

        _ = waitForNumericValueAtLeast(
            element: pillHeightMarker,
            minimum: minExpandedPillHeight,
            timeout: 6
        )
        let snapOpen = app.buttons["chat.fakeKeyboard.snapOpen"]
        let snapClosed = app.buttons["chat.fakeKeyboard.snapClosed"]
        let usesFakeKeyboard = snapOpen.waitForExistence(timeout: 1)
            && snapClosed.waitForExistence(timeout: 1)

        if usesFakeKeyboard {
            snapClosed.tap()
        } else {
            dismissButton.tap()
        }

        let baselineOverlap = waitForStableNumericValue(
            element: overlapMarker,
            timeout: 4,
            tolerance: 0.5,
            stableSamples: 3
        )
        let baselineY = waitForStableBottomY(
            element: marker,
            timeout: 4,
            tolerance: 0.5,
            stableSamples: 3
        )
        let baselinePillTop = waitForStableMinY(
            element: pill,
            timeout: 4,
            tolerance: 0.5,
            stableSamples: 3
        )
        let baselineGap = baselinePillTop - baselineY
        let baselineInset = waitForStableNumericValue(
            element: insetMarker,
            timeout: 4,
            tolerance: 0.5,
            stableSamples: 3
        )

        if usesFakeKeyboard {
            snapOpen.tap()
        } else {
            focusButton.tap()
        }
        var openOverlap = waitForNumericValueAtLeast(
            element: overlapMarker,
            minimum: baselineOverlap + openOverlapMinDelta,
            timeout: 8
        )
        if openOverlap < baselineOverlap + openOverlapMinDelta, snapOpen.exists {
            snapOpen.tap()
            openOverlap = waitForNumericValueAtLeast(
                element: overlapMarker,
                minimum: baselineOverlap + openOverlapMinDelta,
                timeout: 6
            )
        }
        XCTAssertGreaterThanOrEqual(
            openOverlap,
            baselineOverlap + openOverlapMinDelta,
            "Keyboard overlap never reached the open threshold: overlap=\(openOverlap) baseline=\(baselineOverlap)"
        )
        let openPillTop = waitForStableMinY(
            element: pill,
            timeout: 2,
            tolerance: 0.5,
            stableSamples: 3
        )
        let openY = waitForStableBottomY(
            element: marker,
            timeout: 3,
            tolerance: 0.5,
            stableSamples: 3
        )
        let openGap = openPillTop - openY

        if usesFakeKeyboard {
            snapClosed.tap()
        } else {
            dismissButton.tap()
        }
        var closedOverlap = waitForNumericValueNear(
            element: overlapMarker,
            target: baselineOverlap,
            tolerance: 6,
            timeout: 8
        )
        if abs(closedOverlap - baselineOverlap) > 6, snapClosed.exists {
            snapClosed.tap()
            closedOverlap = waitForNumericValueNear(
                element: overlapMarker,
                target: baselineOverlap,
                tolerance: 6,
                timeout: 6
            )
        }
        XCTAssertLessThanOrEqual(
            abs(closedOverlap - baselineOverlap),
            6,
            "Keyboard overlap never returned to closed target: overlap=\(closedOverlap) baseline=\(baselineOverlap)"
        )

        let closedPillTop = waitForPillReturn(
            element: pill,
            baseline: baselinePillTop,
            tolerance: yTolerance,
            timeout: 12
        )
        let closedY = waitForStableBottomY(
            element: marker,
            timeout: 4,
            tolerance: 0.5,
            stableSamples: 3
        )
        let closedGap = closedPillTop - closedY
        let closedInset = waitForStableNumericValue(
            element: insetMarker,
            timeout: 4,
            tolerance: 0.5,
            stableSamples: 3
        )

        let openGapDelta = abs(openGap - baselineGap)
        XCTAssertLessThanOrEqual(
            openGapDelta,
            gapTolerance,
            "Gap changed after keyboard open: baseline=\(baselineGap) open=\(openGap) delta=\(openGapDelta)"
        )
        let delta = abs(closedY - baselineY)
        XCTAssertLessThanOrEqual(
            delta,
            yTolerance,
            "Last assistant message moved after keyboard cycle: baseline=\(baselineY) closed=\(closedY) delta=\(delta)"
        )
        let pillDelta = abs(closedPillTop - baselinePillTop)
        XCTAssertLessThanOrEqual(
            pillDelta,
            yTolerance,
            "Input pill top moved after keyboard cycle: baseline=\(baselinePillTop) closed=\(closedPillTop) delta=\(pillDelta)"
        )
        let gapDelta = abs(closedGap - baselineGap)
        XCTAssertLessThanOrEqual(
            gapDelta,
            gapTolerance,
            "Gap changed after keyboard cycle: baseline=\(baselineGap) closed=\(closedGap) delta=\(gapDelta)"
        )
        let insetDelta = abs(closedInset - baselineInset)
        XCTAssertLessThanOrEqual(
            insetDelta,
            yTolerance,
            "Bottom inset changed after keyboard cycle: baseline=\(baselineInset) closed=\(closedInset) delta=\(insetDelta)"
        )
    }

    func testShortThreadMessagesDoNotShiftDuringKeyboardAnimation() {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_DEBUG_AUTOFOCUS"] = "0"
        app.launchEnvironment["CMUX_UITEST_CHAT_VIEW"] = "1"
        app.launchEnvironment["CMUX_UITEST_CONVERSATION_ID"] = "uitest_conversation_claude"
        app.launchEnvironment["CMUX_UITEST_PROVIDER_ID"] = "claude"
        app.launchEnvironment["CMUX_UITEST_MOCK_DATA"] = "1"
        app.launchEnvironment["CMUX_UITEST_MESSAGE_COUNT"] = "2"
        app.launchEnvironment["CMUX_UITEST_ENDS_WITH_USER"] = "0"
        if ProcessInfo.processInfo.environment["SIMULATOR_UDID"] != nil {
            app.launchEnvironment["CMUX_UITEST_FAKE_KEYBOARD"] = "1"
        }
        app.launch()

        waitForMessages(app: app)

        let userMessage = app.otherElements["chat.message.uitest_msg_claude_1"]
        XCTAssertTrue(userMessage.waitForExistence(timeout: 6))
        let assistantMessage = app.otherElements["chat.message.uitest_msg_claude_2"]
        XCTAssertTrue(assistantMessage.waitForExistence(timeout: 6))

        waitForScrollSettle()

        let snapClosed = app.buttons["chat.fakeKeyboard.snapClosed"]
        if snapClosed.waitForExistence(timeout: 1) {
            snapClosed.tap()
        }

        let baselineUserY = waitForStableMinY(
            element: userMessage,
            timeout: 3,
            tolerance: 0.25,
            stableSamples: 3
        )
        let baselineAssistantY = waitForStableMinY(
            element: assistantMessage,
            timeout: 3,
            tolerance: 0.25,
            stableSamples: 3
        )

        let stepUp = app.buttons["chat.fakeKeyboard.stepUp"]
        let stepDown = app.buttons["chat.fakeKeyboard.stepDown"]
        let usesFakeKeyboard = stepUp.waitForExistence(timeout: 1)
            && stepDown.waitForExistence(timeout: 1)

        if usesFakeKeyboard {
            performKeyboardSteps(
                button: stepUp,
                steps: 12,
                sampleDuration: 0.35,
                userMessage: userMessage,
                assistantMessage: assistantMessage,
                baselineUserY: baselineUserY,
                baselineAssistantY: baselineAssistantY,
                context: "opening keyboard"
            )

            performKeyboardSteps(
                button: stepDown,
                steps: 12,
                sampleDuration: 0.35,
                userMessage: userMessage,
                assistantMessage: assistantMessage,
                baselineUserY: baselineUserY,
                baselineAssistantY: baselineAssistantY,
                context: "closing keyboard"
            )
        } else {
            focusKeyboard(app: app)
            assertMessagePositionsStable(
                userMessage: userMessage,
                assistantMessage: assistantMessage,
                baselineUserY: baselineUserY,
                baselineAssistantY: baselineAssistantY,
                duration: 0.8,
                context: "system keyboard opening"
            )
            dismissKeyboard(app: app)
            assertMessagePositionsStable(
                userMessage: userMessage,
                assistantMessage: assistantMessage,
                baselineUserY: baselineUserY,
                baselineAssistantY: baselineAssistantY,
                duration: 0.8,
                context: "system keyboard closing"
            )
        }
    }

    private func waitForScrollSettle() {
        RunLoop.current.run(until: Date().addingTimeInterval(1.6))
    }

    private func waitForStableBottomY(
        element: XCUIElement,
        timeout: TimeInterval,
        tolerance: CGFloat,
        stableSamples: Int
    ) -> CGFloat {
        return waitForStableValue(timeout: timeout, tolerance: tolerance, stableSamples: stableSamples) {
            element.frame.maxY
        }
    }

    private func waitForStableMinY(
        element: XCUIElement,
        timeout: TimeInterval,
        tolerance: CGFloat,
        stableSamples: Int
    ) -> CGFloat {
        return waitForStableValue(timeout: timeout, tolerance: tolerance, stableSamples: stableSamples) {
            element.frame.minY
        }
    }

    private func waitForPillReturn(
        element: XCUIElement,
        baseline: CGFloat,
        tolerance: CGFloat,
        timeout: TimeInterval
    ) -> CGFloat {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let current = element.frame.minY
            if abs(current - baseline) <= tolerance {
                return waitForStableMinY(
                    element: element,
                    timeout: 2,
                    tolerance: 0.5,
                    stableSamples: 3
                )
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        return element.frame.minY
    }
    private func waitForStableValue(
        timeout: TimeInterval,
        tolerance: CGFloat,
        stableSamples: Int,
        readValue: () -> CGFloat
    ) -> CGFloat {
        let deadline = Date().addingTimeInterval(timeout)
        var lastValue = readValue()
        var stableCount = 0
        while Date() < deadline {
            let currentValue = readValue()
            if currentValue > 1, abs(currentValue - lastValue) <= tolerance {
                stableCount += 1
                if stableCount >= stableSamples {
                    return currentValue
                }
            } else {
                stableCount = 0
                lastValue = currentValue
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        return readValue()
    }

    private func waitForStableNumericValue(
        element: XCUIElement,
        timeout: TimeInterval,
        tolerance: CGFloat,
        stableSamples: Int
    ) -> CGFloat {
        let deadline = Date().addingTimeInterval(timeout)
        var lastValue = readNumericValue(from: element)
        var stableCount = 0
        while Date() < deadline {
            let currentValue = readNumericValue(from: element)
            if currentValue > 0, abs(currentValue - lastValue) <= tolerance {
                stableCount += 1
                if stableCount >= stableSamples {
                    return currentValue
                }
            } else {
                stableCount = 0
                lastValue = currentValue
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        return readNumericValue(from: element)
    }

    private func waitForNumericValueNear(
        element: XCUIElement,
        target: CGFloat,
        tolerance: CGFloat,
        timeout: TimeInterval
    ) -> CGFloat {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let currentValue = readNumericValue(from: element)
            if abs(currentValue - target) <= tolerance {
                return currentValue
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        return readNumericValue(from: element)
    }

    private func waitForNumericValueAtLeast(
        element: XCUIElement,
        minimum: CGFloat,
        timeout: TimeInterval
    ) -> CGFloat {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let currentValue = readNumericValue(from: element)
            if currentValue >= minimum {
                return currentValue
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        return readNumericValue(from: element)
    }
    private func readNumericValue(from element: XCUIElement) -> CGFloat {
        if let value = element.value as? String, let numeric = Double(value) {
            return CGFloat(numeric)
        }
        if let number = element.value as? NSNumber {
            return CGFloat(truncating: number)
        }
        return element.frame.height
    }

    private func performKeyboardSteps(
        button: XCUIElement,
        steps: Int,
        sampleDuration: TimeInterval,
        userMessage: XCUIElement,
        assistantMessage: XCUIElement,
        baselineUserY: CGFloat,
        baselineAssistantY: CGFloat,
        context: String
    ) {
        for index in 0..<steps {
            button.tap()
            assertMessagePositionsStable(
                userMessage: userMessage,
                assistantMessage: assistantMessage,
                baselineUserY: baselineUserY,
                baselineAssistantY: baselineAssistantY,
                duration: sampleDuration,
                context: "\(context) step \(index + 1)"
            )
        }
    }

    private func assertMessagePositionsStable(
        userMessage: XCUIElement,
        assistantMessage: XCUIElement,
        baselineUserY: CGFloat,
        baselineAssistantY: CGFloat,
        duration: TimeInterval,
        context: String
    ) {
        let deadline = Date().addingTimeInterval(duration)
        var sampleIndex = 0
        while Date() < deadline {
            let userY = userMessage.frame.minY
            let assistantY = assistantMessage.frame.minY
            let userDelta = abs(userY - baselineUserY)
            let assistantDelta = abs(assistantY - baselineAssistantY)
            XCTAssertLessThanOrEqual(
                userDelta,
                frameStabilityTolerance,
                "User message moved during \(context) sample \(sampleIndex): baseline=\(baselineUserY) now=\(userY) delta=\(userDelta)"
            )
            XCTAssertLessThanOrEqual(
                assistantDelta,
                frameStabilityTolerance,
                "Assistant message moved during \(context) sample \(sampleIndex): baseline=\(baselineAssistantY) now=\(assistantY) delta=\(assistantDelta)"
            )
            sampleIndex += 1
            RunLoop.current.run(until: Date().addingTimeInterval(frameSampleInterval))
        }
    }

    private func focusKeyboard(app: XCUIApplication) {
        let textView = app.textViews["chat.inputField"]
        let textField = app.textFields["chat.inputField"]
        let pill = app.otherElements["chat.inputPill"]
        if textView.exists {
            textView.tap()
        } else if textField.exists {
            textField.tap()
        } else if pill.exists {
            pill.tap()
        } else {
            app.tap()
        }
    }

    private func dismissKeyboard(app: XCUIApplication) {
        let keyboard = app.keyboards.element
        if keyboard.exists {
            let hide = keyboard.buttons["Hide keyboard"]
            if hide.exists {
                hide.tap()
            } else {
                let dismiss = keyboard.buttons["Dismiss keyboard"]
                if dismiss.exists {
                    dismiss.tap()
                } else {
                    let `return` = keyboard.buttons["Return"]
                    if `return`.exists {
                        `return`.tap()
                    } else {
                        app.tap()
                    }
                }
            }
        } else {
            app.tap()
        }
    }

    private func waitForMessages(app: XCUIApplication) {
        let predicate = NSPredicate(format: "identifier BEGINSWITH %@", "chat.message.")
        let messages = app.otherElements.matching(predicate)
        let first = messages.element(boundBy: 0)
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
    }

    private func locateScrollView(app: XCUIApplication) -> XCUIElement {
        let scroll = app.scrollViews["chat.scroll"]
        if scroll.exists {
            return scroll
        }
        return app.otherElements["chat.scroll"]
    }

}
