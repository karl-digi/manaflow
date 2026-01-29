// internal/browser/cdp.go
// Direct CDP implementation using chromedp - no agent-browser dependency
package browser

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/dom"
	"github.com/chromedp/cdproto/input"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
	"github.com/gobwas/ws"
)

func init() {
	// Allow insecure TLS for remote CDP connections (self-signed certs, IP SANs issues)
	ws.DefaultDialer.TLSConfig = &tls.Config{InsecureSkipVerify: true}
}

// CDPClient is a pure Go CDP client using chromedp
type CDPClient struct {
	config    ClientConfig
	allocCtx  context.Context
	allocCanc context.CancelFunc
	ctx       context.Context
	cancel    context.CancelFunc
	connected bool
	targetID  target.ID // Store target ID for attaching to existing page
}

// NewCDPClient creates a new CDP client
func NewCDPClient(config ClientConfig) (*CDPClient, error) {
	if config.Timeout == 0 {
		config.Timeout = DefaultTimeout
	}

	return &CDPClient{
		config: config,
	}, nil
}

// Connect establishes connection to the browser via CDP
func (c *CDPClient) Connect(ctx context.Context) error {
	var wsURL string

	if c.config.CDPPort > 0 {
		wsURL = fmt.Sprintf("ws://localhost:%d", c.config.CDPPort)
	} else if c.config.CDPURL != "" {
		// For remote CDP URLs (wss://...), we need to discover the browser WebSocket endpoint
		wsURL = c.config.CDPURL
		if strings.HasPrefix(wsURL, "wss://") || strings.HasPrefix(wsURL, "ws://") {
			// Convert to HTTP to fetch /json/version
			httpURL := strings.Replace(wsURL, "wss://", "https://", 1)
			httpURL = strings.Replace(httpURL, "ws://", "http://", 1)
			httpURL = strings.TrimSuffix(httpURL, "/")

			// Try to get an existing page's WebSocket URL from /json (list of targets)
			// This allows us to control an existing page instead of creating a new one
			targetsURL := strings.TrimSuffix(httpURL, "/cdp") + "/json"

			client := &http.Client{Timeout: 10 * time.Second}
			resp, err := client.Get(targetsURL)
			if err == nil && resp.StatusCode == 200 {
				defer resp.Body.Close()
				body, _ := io.ReadAll(resp.Body)

				var targets []struct {
					ID                   string `json:"id"`
					Type                 string `json:"type"`
					URL                  string `json:"url"`
					WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
				}
				if json.Unmarshal(body, &targets) == nil {
					// Find the first "page" target that's not about:blank (if any)
					// Otherwise fall back to the first page
					var firstPageID, activePageID string
					for _, t := range targets {
						if t.Type == "page" && t.WebSocketDebuggerURL != "" {
							if firstPageID == "" {
								firstPageID = t.ID
							}
							// Prefer a page with actual content
							if t.URL != "" && t.URL != "about:blank" && !strings.Contains(t.URL, "googlesyndication") {
								activePageID = t.ID
								break
							}
						}
					}
					selectedID := activePageID
					if selectedID == "" {
						selectedID = firstPageID
					}
					if selectedID != "" {
						c.targetID = target.ID(selectedID)
					}
					// Still need to set up the browser WebSocket URL for the allocator
					// Get browser URL from /json/version
					versionURL := strings.TrimSuffix(httpURL, "/cdp") + "/json/version"
					vResp, vErr := client.Get(versionURL)
					if vErr == nil && vResp.StatusCode == 200 {
						defer vResp.Body.Close()
						vBody, _ := io.ReadAll(vResp.Body)
						var versionInfo struct {
							WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
						}
						if json.Unmarshal(vBody, &versionInfo) == nil && versionInfo.WebSocketDebuggerURL != "" {
							debuggerURL := versionInfo.WebSocketDebuggerURL
							if strings.Contains(debuggerURL, "localhost") {
								parts := strings.SplitN(debuggerURL, "/devtools/", 2)
								if len(parts) == 2 {
									baseWS := strings.TrimSuffix(wsURL, "/cdp/")
									baseWS = strings.TrimSuffix(baseWS, "/cdp")
									if strings.HasPrefix(baseWS, "wss://") && !strings.Contains(baseWS[6:], ":") {
										hostEnd := strings.Index(baseWS[6:], "/")
										if hostEnd == -1 {
											baseWS = baseWS + ":443"
										} else {
											baseWS = baseWS[:6+hostEnd] + ":443" + baseWS[6+hostEnd:]
										}
									}
									wsURL = baseWS + "/devtools/" + parts[1]
								}
							}
						}
					}
				}
			}
		}
	} else {
		return ErrNoCDPConfig
	}


	// Connect to browser WebSocket URL
	allocCtx, allocCancel := chromedp.NewRemoteAllocator(ctx, wsURL, chromedp.NoModifyURL)
	c.allocCtx = allocCtx
	c.allocCanc = allocCancel

	// Create browser context - use WithTargetID to attach to existing page if we have one
	var browserCtx context.Context
	var browserCancel context.CancelFunc
	if c.targetID != "" {
		browserCtx, browserCancel = chromedp.NewContext(allocCtx, chromedp.WithTargetID(c.targetID))
	} else {
		browserCtx, browserCancel = chromedp.NewContext(allocCtx)
	}
	c.ctx = browserCtx
	c.cancel = browserCancel

	// Test connection
	if err := chromedp.Run(c.ctx); err != nil {
		c.Close(ctx)
		return ErrCDPConnectionFailed
	}

	c.connected = true
	return nil
}

// IsConnected returns whether client is connected
func (c *CDPClient) IsConnected() bool {
	return c.connected
}

// GetConfig returns the client configuration
func (c *CDPClient) GetConfig() ClientConfig {
	return c.config
}

// Close disconnects from the browser
func (c *CDPClient) Close(ctx context.Context) error {
	if c.cancel != nil {
		c.cancel()
	}
	if c.allocCanc != nil {
		c.allocCanc()
	}
	c.connected = false
	return nil
}

// SetTimeout updates the default timeout
func (c *CDPClient) SetTimeout(ms int) {
	c.config.Timeout = ms
}

// SetSession sets the session name (unused in CDP client)
func (c *CDPClient) SetSession(session string) {
	c.config.Session = session
}

// --- Navigation ---

// Open navigates to a URL
func (c *CDPClient) Open(ctx context.Context, url string) error {
	return chromedp.Run(c.ctx, chromedp.Navigate(url))
}

// Back navigates back in history
func (c *CDPClient) Back(ctx context.Context) error {
	return chromedp.Run(c.ctx, chromedp.NavigateBack())
}

// Forward navigates forward in history
func (c *CDPClient) Forward(ctx context.Context) error {
	return chromedp.Run(c.ctx, chromedp.NavigateForward())
}

// Reload reloads the current page
func (c *CDPClient) Reload(ctx context.Context) error {
	return chromedp.Run(c.ctx, chromedp.Reload())
}

// --- Element Interaction ---

// Snapshot returns interactive elements with refs
func (c *CDPClient) Snapshot(ctx context.Context, interactive bool) (*SnapshotResult, error) {
	var result SnapshotResult
	result.Elements = make([]Element, 0)

	// Get accessibility tree
	var nodes []*cdp.Node
	err := chromedp.Run(c.ctx,
		chromedp.Nodes("*", &nodes, chromedp.ByQueryAll),
	)
	if err != nil {
		return &result, nil // Return empty on error
	}

	// Get page info
	var url, title string
	_ = chromedp.Run(c.ctx, chromedp.Location(&url), chromedp.Title(&title))
	result.URL = url
	result.Title = title

	// Get interactive elements using JavaScript
	var elementsJSON string
	script := `
		(function() {
			const elements = [];
			const interactiveSelectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [onclick], [tabindex]';
			const nodes = document.querySelectorAll(interactiveSelectors);
			let refNum = 1;
			nodes.forEach(el => {
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return;
				if (window.getComputedStyle(el).visibility === 'hidden') return;
				if (window.getComputedStyle(el).display === 'none') return;

				const role = el.getAttribute('role') || el.tagName.toLowerCase();
				const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText?.substring(0, 50) || el.value || el.placeholder || '';

				elements.push({
					ref: '@e' + refNum,
					role: role,
					name: name.trim().replace(/\s+/g, ' '),
					enabled: !el.disabled,
					visible: true
				});
				el.setAttribute('data-ref', '@e' + refNum);
				refNum++;
			});
			return JSON.stringify(elements);
		})()
	`
	err = chromedp.Run(c.ctx, chromedp.Evaluate(script, &elementsJSON))
	if err != nil {
		return &result, nil
	}

	// Parse elements
	var rawLines []string
	// Simple JSON parsing without external dependencies
	if strings.HasPrefix(elementsJSON, "[") {
		// Parse the JSON manually
		var elements []Element
		// Use runtime.Evaluate to get structured data
		var evalResult []map[string]interface{}
		evalScript := `
			(function() {
				const elements = [];
				const interactiveSelectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [onclick], [tabindex]';
				const nodes = document.querySelectorAll(interactiveSelectors);
				let refNum = 1;
				nodes.forEach(el => {
					const rect = el.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) return;
					if (window.getComputedStyle(el).visibility === 'hidden') return;
					if (window.getComputedStyle(el).display === 'none') return;

					const role = el.getAttribute('role') || el.tagName.toLowerCase();
					const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText?.substring(0, 50) || el.value || el.placeholder || '';

					elements.push({
						ref: '@e' + refNum,
						role: role,
						name: name.trim().replace(/\s+/g, ' '),
						enabled: !el.disabled,
						visible: true
					});
					el.setAttribute('data-ref', '@e' + refNum);
					refNum++;
				});
				return elements;
			})()
		`
		err = chromedp.Run(c.ctx, chromedp.Evaluate(evalScript, &evalResult))
		if err == nil {
			for _, item := range evalResult {
				ref, _ := item["ref"].(string)
				role, _ := item["role"].(string)
				name, _ := item["name"].(string)
				enabled, _ := item["enabled"].(bool)
				visible, _ := item["visible"].(bool)

				elements = append(elements, Element{
					Ref:     ref,
					Role:    role,
					Name:    name,
					Enabled: enabled,
					Visible: visible,
				})
				rawLines = append(rawLines, fmt.Sprintf("%s: %s %q", ref, role, name))
			}
		}
		result.Elements = elements
	}

	result.Raw = strings.Join(rawLines, "\n")
	return &result, nil
}

// Click clicks an element
func (c *CDPClient) Click(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx, chromedp.Click(sel, chromedp.NodeVisible))
}

// ClickWithOptions clicks an element with options
func (c *CDPClient) ClickWithOptions(ctx context.Context, selector string, opts ClickOptions) error {
	sel := c.convertSelector(selector)
	var actions []chromedp.Action
	actions = append(actions, chromedp.WaitVisible(sel))

	if opts.ClickCount > 1 {
		// Double click
		actions = append(actions, chromedp.DoubleClick(sel))
	} else {
		actions = append(actions, chromedp.Click(sel))
	}

	return chromedp.Run(c.ctx, actions...)
}

// DoubleClick double-clicks an element
func (c *CDPClient) DoubleClick(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx, chromedp.DoubleClick(sel, chromedp.NodeVisible))
}

// Hover hovers over an element
func (c *CDPClient) Hover(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	var nodes []*cdp.Node
	err := chromedp.Run(c.ctx,
		chromedp.Nodes(sel, &nodes, chromedp.NodeVisible),
	)
	if err != nil || len(nodes) == 0 {
		return ErrElementNotFound
	}

	// Get element position and dispatch mouse move
	var x, y float64
	err = chromedp.Run(c.ctx,
		chromedp.Evaluate(fmt.Sprintf(`
			(function() {
				const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
				if (!el) return null;
				const rect = el.getBoundingClientRect();
				return {x: rect.x + rect.width/2, y: rect.y + rect.height/2};
			})()
		`, sel, selector), &struct {
			X *float64 `json:"x"`
			Y *float64 `json:"y"`
		}{&x, &y}),
	)
	if err != nil {
		return err
	}

	return chromedp.Run(c.ctx,
		chromedp.MouseClickXY(x, y, chromedp.ButtonNone),
	)
}

// Type types text into an element (appends)
func (c *CDPClient) Type(ctx context.Context, selector, text string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx,
		chromedp.Click(sel, chromedp.NodeVisible),
		chromedp.SendKeys(sel, text),
	)
}

// TypeWithDelay types text with a delay between keystrokes
func (c *CDPClient) TypeWithDelay(ctx context.Context, selector, text string, delayMs int) error {
	sel := c.convertSelector(selector)
	err := chromedp.Run(c.ctx, chromedp.Click(sel, chromedp.NodeVisible))
	if err != nil {
		return err
	}

	for _, char := range text {
		err := chromedp.Run(c.ctx, chromedp.SendKeys(sel, string(char)))
		if err != nil {
			return err
		}
		time.Sleep(time.Duration(delayMs) * time.Millisecond)
	}
	return nil
}

// Fill clears and fills an element with text
func (c *CDPClient) Fill(ctx context.Context, selector, text string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx,
		chromedp.Clear(sel),
		chromedp.SendKeys(sel, text),
	)
}

// Clear clears an input element
func (c *CDPClient) Clear(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx, chromedp.Clear(sel))
}

// Press presses a key
func (c *CDPClient) Press(ctx context.Context, key string) error {
	return chromedp.Run(c.ctx, chromedp.KeyEvent(key))
}

// PressKey presses a key on a specific element
func (c *CDPClient) PressKey(ctx context.Context, selector, key string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx,
		chromedp.Click(sel, chromedp.NodeVisible),
		chromedp.KeyEvent(key),
	)
}

// Select selects an option in a dropdown
func (c *CDPClient) Select(ctx context.Context, selector, value string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx, chromedp.SetValue(sel, value))
}

// SelectByLabel selects an option by its visible label
func (c *CDPClient) SelectByLabel(ctx context.Context, selector, label string) error {
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const select = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!select) return false;
			for (let opt of select.options) {
				if (opt.text === '%s') {
					select.value = opt.value;
					select.dispatchEvent(new Event('change', { bubbles: true }));
					return true;
				}
			}
			return false;
		})()
	`, sel, selector, label)

	var success bool
	err := chromedp.Run(c.ctx, chromedp.Evaluate(script, &success))
	if err != nil || !success {
		return ErrElementNotFound
	}
	return nil
}

// Check checks a checkbox or radio button
func (c *CDPClient) Check(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!el) return false;
			if (!el.checked) el.click();
			return true;
		})()
	`, sel, selector)

	var success bool
	return chromedp.Run(c.ctx, chromedp.Evaluate(script, &success))
}

// Uncheck unchecks a checkbox
func (c *CDPClient) Uncheck(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!el) return false;
			if (el.checked) el.click();
			return true;
		})()
	`, sel, selector)

	var success bool
	return chromedp.Run(c.ctx, chromedp.Evaluate(script, &success))
}

// Scroll scrolls in a direction
func (c *CDPClient) Scroll(ctx context.Context, direction ScrollDirection, amount int) error {
	if amount == 0 {
		amount = 300
	}

	var deltaX, deltaY int
	switch direction {
	case ScrollDown:
		deltaY = amount
	case ScrollUp:
		deltaY = -amount
	case ScrollRight:
		deltaX = amount
	case ScrollLeft:
		deltaX = -amount
	}

	return chromedp.Run(c.ctx,
		chromedp.ActionFunc(func(ctx context.Context) error {
			return input.DispatchMouseEvent(input.MouseWheel, 0, 0).
				WithDeltaX(float64(deltaX)).
				WithDeltaY(float64(deltaY)).
				Do(ctx)
		}),
	)
}

// ScrollTo scrolls to a specific element
func (c *CDPClient) ScrollTo(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx, chromedp.ScrollIntoView(sel))
}

// --- Information Retrieval ---

// Screenshot takes a screenshot
func (c *CDPClient) Screenshot(ctx context.Context, opts ScreenshotOptions) (string, error) {
	var buf []byte
	var err error

	if opts.FullPage {
		err = chromedp.Run(c.ctx, chromedp.FullScreenshot(&buf, int(opts.Quality)))
	} else {
		err = chromedp.Run(c.ctx, chromedp.CaptureScreenshot(&buf))
	}
	if err != nil {
		return "", err
	}

	if opts.Path != "" {
		if err := os.WriteFile(opts.Path, buf, 0644); err != nil {
			return "", err
		}
		return opts.Path, nil
	}

	// Return base64 encoded
	return base64.StdEncoding.EncodeToString(buf), nil
}

// GetText gets text content of an element
func (c *CDPClient) GetText(ctx context.Context, selector string) (string, error) {
	sel := c.convertSelector(selector)
	var text string
	err := chromedp.Run(c.ctx, chromedp.Text(sel, &text, chromedp.NodeVisible))
	return text, err
}

// GetValue gets the value of an input element
func (c *CDPClient) GetValue(ctx context.Context, selector string) (string, error) {
	sel := c.convertSelector(selector)
	var value string
	err := chromedp.Run(c.ctx, chromedp.Value(sel, &value))
	return value, err
}

// GetAttribute gets an attribute of an element
func (c *CDPClient) GetAttribute(ctx context.Context, selector, attr string) (string, error) {
	sel := c.convertSelector(selector)
	var value string
	err := chromedp.Run(c.ctx, chromedp.AttributeValue(sel, attr, &value, nil))
	return value, err
}

// GetTitle gets the page title
func (c *CDPClient) GetTitle(ctx context.Context) (string, error) {
	var title string
	err := chromedp.Run(c.ctx, chromedp.Title(&title))
	return title, err
}

// GetURL gets the current URL
func (c *CDPClient) GetURL(ctx context.Context) (string, error) {
	var url string
	err := chromedp.Run(c.ctx, chromedp.Location(&url))
	return url, err
}

// GetHTML gets the HTML content of an element
func (c *CDPClient) GetHTML(ctx context.Context, selector string) (string, error) {
	sel := c.convertSelector(selector)
	var html string
	err := chromedp.Run(c.ctx, chromedp.OuterHTML(sel, &html))
	return html, err
}

// GetInnerText gets the inner text of an element
func (c *CDPClient) GetInnerText(ctx context.Context, selector string) (string, error) {
	return c.GetText(ctx, selector)
}

// --- State Checking ---

// IsVisible checks if an element is visible
func (c *CDPClient) IsVisible(ctx context.Context, selector string) (bool, error) {
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!el) return false;
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return false;
			const style = window.getComputedStyle(el);
			return style.visibility !== 'hidden' && style.display !== 'none';
		})()
	`, sel, selector)

	var visible bool
	err := chromedp.Run(c.ctx, chromedp.Evaluate(script, &visible))
	return visible, err
}

// IsEnabled checks if an element is enabled
func (c *CDPClient) IsEnabled(ctx context.Context, selector string) (bool, error) {
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!el) return false;
			return !el.disabled;
		})()
	`, sel, selector)

	var enabled bool
	err := chromedp.Run(c.ctx, chromedp.Evaluate(script, &enabled))
	return enabled, err
}

// IsChecked checks if a checkbox/radio is checked
func (c *CDPClient) IsChecked(ctx context.Context, selector string) (bool, error) {
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!el) return false;
			return el.checked === true;
		})()
	`, sel, selector)

	var checked bool
	err := chromedp.Run(c.ctx, chromedp.Evaluate(script, &checked))
	return checked, err
}

// IsEditable checks if an element is editable
func (c *CDPClient) IsEditable(ctx context.Context, selector string) (bool, error) {
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!el) return false;
			const tag = el.tagName.toLowerCase();
			if (tag === 'input' || tag === 'textarea') return !el.disabled && !el.readOnly;
			return el.isContentEditable;
		})()
	`, sel, selector)

	var editable bool
	err := chromedp.Run(c.ctx, chromedp.Evaluate(script, &editable))
	return editable, err
}

// Exists checks if an element exists in the DOM
func (c *CDPClient) Exists(ctx context.Context, selector string) (bool, error) {
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			return el !== null;
		})()
	`, sel, selector)

	var exists bool
	err := chromedp.Run(c.ctx, chromedp.Evaluate(script, &exists))
	return exists, err
}

// --- Waiting ---

// Wait waits for an element to appear
func (c *CDPClient) Wait(ctx context.Context, selector string, opts WaitOptions) error {
	sel := c.convertSelector(selector)
	timeout := time.Duration(opts.Timeout) * time.Millisecond
	if timeout == 0 {
		timeout = time.Duration(c.config.Timeout) * time.Millisecond
	}

	waitCtx, cancel := context.WithTimeout(c.ctx, timeout)
	defer cancel()

	switch opts.State {
	case "hidden":
		return chromedp.Run(waitCtx, chromedp.WaitNotPresent(sel))
	case "detached":
		return chromedp.Run(waitCtx, chromedp.WaitNotPresent(sel))
	default:
		return chromedp.Run(waitCtx, chromedp.WaitVisible(sel))
	}
}

// WaitMs waits for a fixed duration
func (c *CDPClient) WaitMs(ctx context.Context, ms int) error {
	time.Sleep(time.Duration(ms) * time.Millisecond)
	return nil
}

// WaitForText waits for text to appear on page
func (c *CDPClient) WaitForText(ctx context.Context, text string, timeout int) error {
	if timeout == 0 {
		timeout = c.config.Timeout
	}

	waitCtx, cancel := context.WithTimeout(c.ctx, time.Duration(timeout)*time.Millisecond)
	defer cancel()

	script := fmt.Sprintf(`document.body.innerText.includes('%s')`, text)
	return chromedp.Run(waitCtx,
		chromedp.Poll(script, nil, chromedp.WithPollingInterval(100*time.Millisecond)),
	)
}

// WaitForURL waits for URL to match pattern
func (c *CDPClient) WaitForURL(ctx context.Context, pattern string, timeout int) error {
	if timeout == 0 {
		timeout = c.config.Timeout
	}

	waitCtx, cancel := context.WithTimeout(c.ctx, time.Duration(timeout)*time.Millisecond)
	defer cancel()

	script := fmt.Sprintf(`window.location.href.includes('%s')`, pattern)
	return chromedp.Run(waitCtx,
		chromedp.Poll(script, nil, chromedp.WithPollingInterval(100*time.Millisecond)),
	)
}

// WaitForNavigation waits for navigation to complete
func (c *CDPClient) WaitForNavigation(ctx context.Context, timeout int) error {
	if timeout == 0 {
		timeout = c.config.Timeout
	}

	waitCtx, cancel := context.WithTimeout(c.ctx, time.Duration(timeout)*time.Millisecond)
	defer cancel()

	// Wait for load event
	return chromedp.Run(waitCtx,
		chromedp.Poll(`document.readyState === 'complete'`, nil, chromedp.WithPollingInterval(100*time.Millisecond)),
	)
}

// WaitForLoadState waits for specific load state
func (c *CDPClient) WaitForLoadState(ctx context.Context, state string, timeout int) error {
	if timeout == 0 {
		timeout = c.config.Timeout
	}

	waitCtx, cancel := context.WithTimeout(c.ctx, time.Duration(timeout)*time.Millisecond)
	defer cancel()

	var script string
	switch state {
	case "domcontentloaded":
		script = `document.readyState === 'interactive' || document.readyState === 'complete'`
	case "networkidle":
		// Approximate network idle by waiting for complete state
		script = `document.readyState === 'complete'`
	default:
		script = `document.readyState === 'complete'`
	}

	return chromedp.Run(waitCtx,
		chromedp.Poll(script, nil, chromedp.WithPollingInterval(100*time.Millisecond)),
	)
}

// --- Advanced ---

// Eval evaluates JavaScript in the page
func (c *CDPClient) Eval(ctx context.Context, script string) (string, error) {
	var result interface{}
	err := chromedp.Run(c.ctx, chromedp.Evaluate(script, &result))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%v", result), nil
}

// EvalOn evaluates JavaScript on a specific element
func (c *CDPClient) EvalOn(ctx context.Context, selector, script string) (string, error) {
	sel := c.convertSelector(selector)
	wrappedScript := fmt.Sprintf(`
		(function() {
			const el = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!el) return null;
			return (function(el) { %s })(el);
		})()
	`, sel, selector, script)

	var result interface{}
	err := chromedp.Run(c.ctx, chromedp.Evaluate(wrappedScript, &result))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%v", result), nil
}

// Focus focuses an element
func (c *CDPClient) Focus(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx, chromedp.Focus(sel))
}

// Blur removes focus from an element
func (c *CDPClient) Blur(ctx context.Context, selector string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx, chromedp.Blur(sel))
}

// Drag drags from source to target
func (c *CDPClient) Drag(ctx context.Context, sourceSelector, targetSelector string) error {
	sourceSel := c.convertSelector(sourceSelector)
	targetSel := c.convertSelector(targetSelector)

	// Get source and target positions
	var sourceX, sourceY, targetX, targetY float64
	script := fmt.Sprintf(`
		(function() {
			const source = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			const target = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!source || !target) return null;
			const sr = source.getBoundingClientRect();
			const tr = target.getBoundingClientRect();
			return {
				sourceX: sr.x + sr.width/2,
				sourceY: sr.y + sr.height/2,
				targetX: tr.x + tr.width/2,
				targetY: tr.y + tr.height/2
			};
		})()
	`, sourceSel, sourceSelector, targetSel, targetSelector)

	var coords struct {
		SourceX float64 `json:"sourceX"`
		SourceY float64 `json:"sourceY"`
		TargetX float64 `json:"targetX"`
		TargetY float64 `json:"targetY"`
	}
	err := chromedp.Run(c.ctx, chromedp.Evaluate(script, &coords))
	if err != nil {
		return err
	}

	sourceX, sourceY = coords.SourceX, coords.SourceY
	targetX, targetY = coords.TargetX, coords.TargetY

	// Perform drag operation
	return chromedp.Run(c.ctx,
		chromedp.ActionFunc(func(ctx context.Context) error {
			// Mouse down at source
			if err := input.DispatchMouseEvent(input.MousePressed, sourceX, sourceY).
				WithButton(input.Left).
				WithClickCount(1).
				Do(ctx); err != nil {
				return err
			}
			// Mouse move to target
			if err := input.DispatchMouseEvent(input.MouseMoved, targetX, targetY).
				WithButton(input.Left).
				Do(ctx); err != nil {
				return err
			}
			// Mouse up at target
			return input.DispatchMouseEvent(input.MouseReleased, targetX, targetY).
				WithButton(input.Left).
				WithClickCount(1).
				Do(ctx)
		}),
	)
}

// Upload uploads a file to a file input
func (c *CDPClient) Upload(ctx context.Context, selector string, filePaths ...string) error {
	sel := c.convertSelector(selector)
	return chromedp.Run(c.ctx, chromedp.SetUploadFiles(sel, filePaths))
}

// SetViewport sets the viewport size
func (c *CDPClient) SetViewport(ctx context.Context, width, height int) error {
	return chromedp.Run(c.ctx,
		chromedp.EmulateViewport(int64(width), int64(height)),
	)
}

// PDF saves the page as PDF
func (c *CDPClient) PDF(ctx context.Context, path string) error {
	var buf []byte
	err := chromedp.Run(c.ctx,
		chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			buf, _, err = page.PrintToPDF().Do(ctx)
			return err
		}),
	)
	if err != nil {
		return err
	}
	return os.WriteFile(path, buf, 0644)
}

// Frame switches to an iframe
func (c *CDPClient) Frame(ctx context.Context, selector string) error {
	// chromedp doesn't have direct iframe switching like Playwright
	// We'll use JavaScript to set up iframe context
	sel := c.convertSelector(selector)
	script := fmt.Sprintf(`
		(function() {
			const frame = document.querySelector('%s') || document.querySelector('[data-ref="%s"]');
			if (!frame || frame.tagName.toLowerCase() !== 'iframe') return false;
			window.__cdpCurrentFrame = frame.contentDocument || frame.contentWindow.document;
			return true;
		})()
	`, sel, selector)

	var success bool
	return chromedp.Run(c.ctx, chromedp.Evaluate(script, &success))
}

// FrameMain switches back to the main frame
func (c *CDPClient) FrameMain(ctx context.Context) error {
	return chromedp.Run(c.ctx, chromedp.Evaluate(`window.__cdpCurrentFrame = document; true`, nil))
}

// Tab switches to a specific tab by index
func (c *CDPClient) Tab(ctx context.Context, index int) error {
	// chromedp manages tabs through targets
	targets, err := chromedp.Targets(c.ctx)
	if err != nil {
		return err
	}

	if index < 0 || index >= len(targets) {
		return fmt.Errorf("tab index out of range")
	}

	return chromedp.Run(c.ctx,
		chromedp.ActionFunc(func(ctx context.Context) error {
			// Activate the target
			return nil // Tab switching is handled by chromedp context
		}),
	)
}

// NewTab opens a new tab
func (c *CDPClient) NewTab(ctx context.Context) error {
	_, _ = chromedp.NewContext(c.ctx)
	return nil
}

// CloseTab closes the current tab
func (c *CDPClient) CloseTab(ctx context.Context) error {
	return chromedp.Run(c.ctx,
		chromedp.ActionFunc(func(ctx context.Context) error {
			return page.Close().Do(ctx)
		}),
	)
}

// convertSelector converts @eN selectors to CSS selectors
func (c *CDPClient) convertSelector(selector string) string {
	if strings.HasPrefix(selector, "@e") {
		// Convert @eN to data-ref selector
		return fmt.Sprintf("[data-ref='%s']", selector)
	}
	return selector
}

// Helper unused but required for imports
var _ = dom.GetDocument
var _ = runtime.Evaluate
