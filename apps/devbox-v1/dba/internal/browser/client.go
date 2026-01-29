// Package browser provides browser automation via Chrome DevTools Protocol (CDP).
// This package uses chromedp for direct CDP communication - no external dependencies required.
package browser

import (
	"context"
)

// DefaultTimeout is the default timeout for browser operations in milliseconds
const DefaultTimeout = 30000

// BrowserClient is the interface for browser automation
type BrowserClient interface {
	Connect(ctx context.Context) error
	IsConnected() bool
	GetConfig() ClientConfig
	Close(ctx context.Context) error
	SetTimeout(ms int)
	SetSession(session string)

	// Navigation
	Open(ctx context.Context, url string) error
	Back(ctx context.Context) error
	Forward(ctx context.Context) error
	Reload(ctx context.Context) error

	// Element interaction
	Snapshot(ctx context.Context, interactive bool) (*SnapshotResult, error)
	Click(ctx context.Context, selector string) error
	ClickWithOptions(ctx context.Context, selector string, opts ClickOptions) error
	DoubleClick(ctx context.Context, selector string) error
	Hover(ctx context.Context, selector string) error
	Type(ctx context.Context, selector, text string) error
	TypeWithDelay(ctx context.Context, selector, text string, delayMs int) error
	Fill(ctx context.Context, selector, text string) error
	Clear(ctx context.Context, selector string) error
	Press(ctx context.Context, key string) error
	PressKey(ctx context.Context, selector, key string) error
	Select(ctx context.Context, selector, value string) error
	SelectByLabel(ctx context.Context, selector, label string) error
	Check(ctx context.Context, selector string) error
	Uncheck(ctx context.Context, selector string) error
	Scroll(ctx context.Context, direction ScrollDirection, amount int) error
	ScrollTo(ctx context.Context, selector string) error

	// Information retrieval
	Screenshot(ctx context.Context, opts ScreenshotOptions) (string, error)
	GetText(ctx context.Context, selector string) (string, error)
	GetValue(ctx context.Context, selector string) (string, error)
	GetAttribute(ctx context.Context, selector, attr string) (string, error)
	GetTitle(ctx context.Context) (string, error)
	GetURL(ctx context.Context) (string, error)
	GetHTML(ctx context.Context, selector string) (string, error)
	GetInnerText(ctx context.Context, selector string) (string, error)

	// State checking
	IsVisible(ctx context.Context, selector string) (bool, error)
	IsEnabled(ctx context.Context, selector string) (bool, error)
	IsChecked(ctx context.Context, selector string) (bool, error)
	IsEditable(ctx context.Context, selector string) (bool, error)
	Exists(ctx context.Context, selector string) (bool, error)

	// Waiting
	Wait(ctx context.Context, selector string, opts WaitOptions) error
	WaitMs(ctx context.Context, ms int) error
	WaitForText(ctx context.Context, text string, timeout int) error
	WaitForURL(ctx context.Context, pattern string, timeout int) error
	WaitForNavigation(ctx context.Context, timeout int) error
	WaitForLoadState(ctx context.Context, state string, timeout int) error

	// Advanced
	Eval(ctx context.Context, script string) (string, error)
	EvalOn(ctx context.Context, selector, script string) (string, error)
	Focus(ctx context.Context, selector string) error
	Blur(ctx context.Context, selector string) error
	Drag(ctx context.Context, sourceSelector, targetSelector string) error
	Upload(ctx context.Context, selector string, filePaths ...string) error
	SetViewport(ctx context.Context, width, height int) error
	PDF(ctx context.Context, path string) error
	Frame(ctx context.Context, selector string) error
	FrameMain(ctx context.Context) error
	Tab(ctx context.Context, index int) error
	NewTab(ctx context.Context) error
	CloseTab(ctx context.Context) error
}

// Client is the default browser client using chromedp (pure Go)
type Client = CDPClient

// NewClient creates a new browser client using chromedp
// This is the recommended way to create a browser client as it requires no external dependencies.
func NewClient(config ClientConfig) (*CDPClient, error) {
	return NewCDPClient(config)
}

// Ensure CDPClient implements BrowserClient interface
var _ BrowserClient = (*CDPClient)(nil)
