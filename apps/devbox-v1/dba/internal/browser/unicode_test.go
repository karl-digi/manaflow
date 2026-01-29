package browser

import (
	"strings"
	"testing"
	"unicode"
)

// TestUnicodeWhitespaceVariations tests various Unicode whitespace characters
func TestUnicodeWhitespaceVariations(t *testing.T) {
	// Various Unicode whitespace characters
	whitespaces := []struct {
		name string
		char string
	}{
		{"space", " "},
		{"tab", "\t"},
		{"newline", "\n"},
		{"carriage return", "\r"},
		{"form feed", "\f"},
		{"vertical tab", "\v"},
		{"no-break space", "\u00A0"},
		{"ogham space mark", "\u1680"},
		{"en quad", "\u2000"},
		{"em quad", "\u2001"},
		{"en space", "\u2002"},
		{"em space", "\u2003"},
		{"three-per-em space", "\u2004"},
		{"four-per-em space", "\u2005"},
		{"six-per-em space", "\u2006"},
		{"figure space", "\u2007"},
		{"punctuation space", "\u2008"},
		{"thin space", "\u2009"},
		{"hair space", "\u200A"},
		{"zero width space", "\u200B"},
		{"narrow no-break space", "\u202F"},
		{"medium mathematical space", "\u205F"},
		{"ideographic space", "\u3000"},
		{"zero width no-break space", "\uFEFF"},
	}

	for _, ws := range whitespaces {
		t.Run(ws.name, func(t *testing.T) {
			// Test whitespace before ref
			input := ws.char + "@e1: button \"Test\""
			result := ParseSnapshot(input)
			// Should handle gracefully (may or may not parse depending on TrimSpace behavior)
			_ = result.Count()

			// Test whitespace in name
			input2 := "@e1: button \"Test" + ws.char + "Name\""
			result2 := ParseSnapshot(input2)
			_ = result2.Count()
		})
	}
}

// TestUnicodeNormalizationForms tests various Unicode normalization scenarios
func TestUnicodeNormalizationForms(t *testing.T) {
	// é can be represented as:
	// - U+00E9 (precomposed)
	// - U+0065 U+0301 (decomposed: e + combining acute)
	testCases := []struct {
		name  string
		input string
	}{
		{"precomposed e-acute", "@e1: button \"café\""},
		{"decomposed e-acute", "@e1: button \"cafe\u0301\""},
		{"precomposed n-tilde", "@e1: button \"señor\""},
		{"decomposed n-tilde", "@e1: button \"sen\u0303or\""},
		{"precomposed o-umlaut", "@e1: button \"schön\""},
		{"decomposed o-umlaut", "@e1: button \"scho\u0308n\""},
		{"hangul precomposed", "@e1: button \"한글\""},
		{"hangul jamo", "@e1: button \"\u1112\u1161\u11AB\u1100\u1173\u11AF\""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
		})
	}
}

// TestUnicodeSurrogatePairs tests handling of characters outside BMP
func TestUnicodeSurrogatePairs(t *testing.T) {
	// Characters that require surrogate pairs in UTF-16
	testCases := []struct {
		name  string
		input string
	}{
		{"emoji smile", "@e1: button \"😀\""},
		{"emoji family", "@e1: button \"👨‍👩‍👧‍👦\""},
		{"emoji flag", "@e1: button \"🇺🇸\""},
		{"musical symbol", "@e1: button \"𝄞\""},
		{"ancient greek", "@e1: button \"𐀀\""},
		{"egyptian hieroglyph", "@e1: button \"𓀀\""},
		{"math symbol", "@e1: button \"𝕏\""},
		{"cjk extension b", "@e1: button \"𠀀\""},
		{"multiple astral", "@e1: button \"🎉🎊🎁\""},
		{"mixed bmp and astral", "@e1: button \"Hello 🌍 World\""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
			// Verify the name is preserved
			if result.Elements[0].Name == "" {
				t.Error("name should not be empty")
			}
		})
	}
}

// TestUnicodeDirectionality tests bidirectional text
func TestUnicodeDirectionality(t *testing.T) {
	testCases := []struct {
		name  string
		input string
	}{
		{"rtl arabic", "@e1: button \"مرحبا\""},
		{"rtl hebrew", "@e1: button \"שלום\""},
		{"mixed ltr rtl", "@e1: button \"Hello مرحبا World\""},
		{"rtl with numbers", "@e1: button \"מחיר: 100\""},
		{"explicit ltr mark", "@e1: button \"\u200EHello\""},
		{"explicit rtl mark", "@e1: button \"\u200Fשלום\""},
		{"rtl override", "@e1: button \"\u202Edesrever\""},
		{"ltr override", "@e1: button \"\u202Dnormal\""},
		{"pop directional", "@e1: button \"\u202Erev\u202Cnormal\""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
		})
	}
}

// TestUnicodeControlCharacters tests control character handling
func TestUnicodeControlCharacters(t *testing.T) {
	// Control characters that might appear in output
	controls := []struct {
		name string
		char string
	}{
		{"null", "\x00"},
		{"start of heading", "\x01"},
		{"start of text", "\x02"},
		{"end of text", "\x03"},
		{"end of transmission", "\x04"},
		{"enquiry", "\x05"},
		{"acknowledge", "\x06"},
		{"bell", "\x07"},
		{"backspace", "\x08"},
		{"escape", "\x1B"},
		{"delete", "\x7F"},
		{"c1 control", "\x80"},
		{"c1 control 2", "\x9F"},
	}

	for _, ctrl := range controls {
		t.Run(ctrl.name, func(t *testing.T) {
			input := "@e1: button \"Test" + ctrl.char + "Name\""
			result := ParseSnapshot(input)
			// Should not panic
			_ = result.Count()
		})
	}
}

// TestUnicodeLineBreaks tests various line break characters
func TestUnicodeLineBreaks(t *testing.T) {
	lineBreaks := []struct {
		name string
		char string
	}{
		{"line feed", "\n"},
		{"carriage return", "\r"},
		{"crlf", "\r\n"},
		{"vertical tab", "\v"},
		{"form feed", "\f"},
		{"next line", "\u0085"},
		{"line separator", "\u2028"},
		{"paragraph separator", "\u2029"},
	}

	for _, lb := range lineBreaks {
		t.Run(lb.name, func(t *testing.T) {
			input := "@e1: button \"First\"" + lb.char + "@e2: button \"Second\""
			result := ParseSnapshot(input)
			// Should parse as two separate lines (or handle gracefully)
			_ = result.Count()
		})
	}
}

// TestUnicodeCaseFolding tests case-insensitive operations
func TestUnicodeCaseFolding(t *testing.T) {
	testCases := []struct {
		name   string
		input  string
		search string
		found  bool
	}{
		{"lowercase ascii", "@e1: button \"hello\"", "HELLO", true},
		{"uppercase ascii", "@e1: button \"HELLO\"", "hello", true},
		{"mixed case", "@e1: button \"HeLLo\"", "hello", true},
		{"german sharp s", "@e1: button \"straße\"", "STRASSE", false}, // ß doesn't case-fold in Go's ToLower
		{"turkish i", "@e1: button \"Istanbul\"", "istanbul", true},
		{"greek sigma", "@e1: button \"ΣΩΚΡΑΤΗΣ\"", "σωκρατης", false}, // Greek has final sigma ς vs σ
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			found := result.FindElementsByText(tc.search)
			hasResults := len(found) > 0
			if hasResults != tc.found {
				t.Errorf("expected found=%v, got %v", tc.found, hasResults)
			}
		})
	}
}

// TestUnicodeZeroWidth tests zero-width characters
func TestUnicodeZeroWidth(t *testing.T) {
	zeroWidths := []struct {
		name string
		char string
	}{
		{"zero width space", "\u200B"},
		{"zero width non-joiner", "\u200C"},
		{"zero width joiner", "\u200D"},
		{"word joiner", "\u2060"},
		{"zero width no-break space", "\uFEFF"},
	}

	for _, zw := range zeroWidths {
		t.Run(zw.name, func(t *testing.T) {
			input := "@e1: button \"Test" + zw.char + "Name\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
		})
	}
}

// TestUnicodeCombiningMarks tests combining diacritical marks
func TestUnicodeCombiningMarks(t *testing.T) {
	combiningMarks := []struct {
		name string
		char string
	}{
		{"combining acute", "\u0301"},
		{"combining grave", "\u0300"},
		{"combining circumflex", "\u0302"},
		{"combining tilde", "\u0303"},
		{"combining macron", "\u0304"},
		{"combining diaeresis", "\u0308"},
		{"combining ring above", "\u030A"},
		{"combining cedilla", "\u0327"},
		{"combining dot above", "\u0307"},
	}

	for _, cm := range combiningMarks {
		t.Run(cm.name, func(t *testing.T) {
			input := "@e1: button \"e" + cm.char + "\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
		})
	}
}

// TestUnicodeScripts tests various Unicode scripts
func TestUnicodeScripts(t *testing.T) {
	scripts := []struct {
		name string
		text string
	}{
		{"latin", "Hello"},
		{"cyrillic", "Привет"},
		{"greek", "Γειά"},
		{"arabic", "مرحبا"},
		{"hebrew", "שלום"},
		{"devanagari", "नमस्ते"},
		{"thai", "สวัสดี"},
		{"japanese hiragana", "こんにちは"},
		{"japanese katakana", "コンニチハ"},
		{"korean hangul", "안녕하세요"},
		{"chinese simplified", "你好"},
		{"chinese traditional", "你好"},
		{"tamil", "வணக்கம்"},
		{"telugu", "నమస్కారం"},
		{"bengali", "নমস্কার"},
		{"gujarati", "નમસ્તે"},
		{"kannada", "ನಮಸ್ಕಾರ"},
		{"malayalam", "നമസ്കാരം"},
		{"punjabi", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ"},
		{"sinhala", "ආයුබෝවන්"},
		{"burmese", "မင်္ဂလာပါ"},
		{"khmer", "សួស្តី"},
		{"lao", "ສະບາຍດີ"},
		{"tibetan", "བཀྲ་ཤིས་བདེ་ལེགས"},
		{"georgian", "გამარჯობა"},
		{"armenian", "Բdelays"},
		{"ethiopic", "ሰላም"},
	}

	for _, s := range scripts {
		t.Run(s.name, func(t *testing.T) {
			input := "@e1: button \"" + s.text + "\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
			if result.Elements[0].Name != s.text {
				t.Errorf("expected name %q, got %q", s.text, result.Elements[0].Name)
			}
		})
	}
}

// TestUnicodeMathSymbols tests mathematical symbols
func TestUnicodeMathSymbols(t *testing.T) {
	mathSymbols := []string{
		"∀∁∂∃∄∅∆∇∈∉∊∋∌∍∎∏",
		"∐∑−∓∔∕∖∗∘∙√∛∜∝∞∟",
		"∠∡∢∣∤∥∦∧∨∩∪∫∬∭∮∯",
		"≠≡≢≣≤≥≦≧≨≩≪≫≬≭≮≯",
		"⊂⊃⊄⊅⊆⊇⊈⊉⊊⊋⊌⊍⊎⊏⊐⊑",
	}

	for i, symbols := range mathSymbols {
		t.Run("math_set_"+string(rune('A'+i)), func(t *testing.T) {
			input := "@e1: button \"" + symbols + "\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
		})
	}
}

// TestUnicodePrivateUse tests private use area characters
func TestUnicodePrivateUse(t *testing.T) {
	privateUse := []struct {
		name string
		char string
	}{
		{"pua start", "\uE000"},
		{"pua middle", "\uE500"},
		{"pua end", "\uF8FF"},
		{"supplementary pua a", "\U000F0000"},
		{"supplementary pua b", "\U00100000"},
	}

	for _, pu := range privateUse {
		t.Run(pu.name, func(t *testing.T) {
			input := "@e1: button \"" + pu.char + "\""
			result := ParseSnapshot(input)
			// Should handle private use characters
			_ = result.Count()
		})
	}
}

// TestUnicodeSpecialCharacters tests special Unicode characters
func TestUnicodeSpecialCharacters(t *testing.T) {
	specials := []struct {
		name string
		char string
	}{
		{"replacement char", "\uFFFD"},
		{"object replacement", "\uFFFC"},
		{"byte order mark", "\uFEFF"},
		{"soft hyphen", "\u00AD"},
		{"non-breaking hyphen", "\u2011"},
		{"figure dash", "\u2012"},
		{"en dash", "\u2013"},
		{"em dash", "\u2014"},
		{"horizontal bar", "\u2015"},
		{"double low line", "\u2017"},
		{"left single quote", "\u2018"},
		{"right single quote", "\u2019"},
		{"left double quote", "\u201C"},
		{"right double quote", "\u201D"},
		{"bullet", "\u2022"},
		{"ellipsis", "\u2026"},
		{"per mille", "\u2030"},
		{"prime", "\u2032"},
		{"double prime", "\u2033"},
	}

	for _, sp := range specials {
		t.Run(sp.name, func(t *testing.T) {
			input := "@e1: button \"Test" + sp.char + "Name\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
		})
	}
}

// TestUnicodeStringLength tests string length edge cases
func TestUnicodeStringLength(t *testing.T) {
	t.Run("single byte char count", func(t *testing.T) {
		input := "@e1: button \"abc\""
		result := ParseSnapshot(input)
		if len(result.Elements[0].Name) != 3 {
			t.Errorf("expected len 3, got %d", len(result.Elements[0].Name))
		}
	})

	t.Run("multi byte char length", func(t *testing.T) {
		input := "@e1: button \"日本語\""
		result := ParseSnapshot(input)
		// Length in bytes, not runes
		if len(result.Elements[0].Name) != 9 { // 3 chars * 3 bytes each
			t.Errorf("expected byte len 9, got %d", len(result.Elements[0].Name))
		}
	})

	t.Run("emoji length", func(t *testing.T) {
		input := "@e1: button \"😀\""
		result := ParseSnapshot(input)
		// Emoji is 4 bytes in UTF-8
		if len(result.Elements[0].Name) != 4 {
			t.Errorf("expected byte len 4, got %d", len(result.Elements[0].Name))
		}
	})

	t.Run("complex emoji length", func(t *testing.T) {
		// Family emoji: man + ZWJ + woman + ZWJ + girl + ZWJ + boy
		input := "@e1: button \"👨‍👩‍👧‍👦\""
		result := ParseSnapshot(input)
		// This is actually multiple code points joined
		if len(result.Elements[0].Name) == 0 {
			t.Error("name should not be empty")
		}
	})
}

// TestUnicodeValidation tests invalid UTF-8 sequences
func TestUnicodeValidation(t *testing.T) {
	invalidSequences := []struct {
		name  string
		bytes []byte
	}{
		{"truncated 2-byte", []byte{0xC2}},
		{"truncated 3-byte", []byte{0xE0, 0x80}},
		{"truncated 4-byte", []byte{0xF0, 0x80, 0x80}},
		{"invalid continuation", []byte{0x80}},
		{"overlong 2-byte", []byte{0xC0, 0xAF}},
		{"overlong 3-byte", []byte{0xE0, 0x80, 0xAF}},
		{"invalid 4-byte start", []byte{0xF5, 0x80, 0x80, 0x80}},
		{"surrogate half", []byte{0xED, 0xA0, 0x80}},
	}

	for _, seq := range invalidSequences {
		t.Run(seq.name, func(t *testing.T) {
			input := "@e1: button \"" + string(seq.bytes) + "\""
			// Should not panic on invalid UTF-8
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("panic on invalid UTF-8: %v", r)
				}
			}()
			result := ParseSnapshot(input)
			_ = result.Count()
		})
	}
}

// TestUnicodeGraphemeClusters tests grapheme cluster handling
func TestUnicodeGraphemeClusters(t *testing.T) {
	clusters := []struct {
		name    string
		cluster string
	}{
		{"flag us", "🇺🇸"},
		{"flag japan", "🇯🇵"},
		{"skin tone", "👋🏽"},
		{"family", "👨‍👩‍👧‍👦"},
		{"profession", "👩‍🔬"},
		{"couple", "👩‍❤️‍👨"},
		{"rainbow flag", "🏳️‍🌈"},
	}

	for _, c := range clusters {
		t.Run(c.name, func(t *testing.T) {
			input := "@e1: button \"" + c.cluster + "\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("expected 1 element, got %d", len(result.Elements))
			}
			if result.Elements[0].Name != c.cluster {
				t.Errorf("grapheme cluster not preserved")
			}
		})
	}
}

// BenchmarkUnicodeParsing benchmarks parsing with Unicode content
func BenchmarkUnicodeParsing(b *testing.B) {
	inputs := map[string]string{
		"ascii":    "@e1: button \"Hello World\"",
		"chinese":  "@e1: button \"你好世界\"",
		"arabic":   "@e1: button \"مرحبا بالعالم\"",
		"emoji":    "@e1: button \"Hello 🌍 World 🎉\"",
		"mixed":    "@e1: button \"Hello 你好 🌍 مرحبا\"",
	}

	for name, input := range inputs {
		b.Run(name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				_ = ParseSnapshot(input)
			}
		})
	}
}

// TestIsGraphic tests that element names contain valid graphic characters
func TestIsGraphic(t *testing.T) {
	input := "@e1: button \"Hello World\""
	result := ParseSnapshot(input)

	for _, r := range result.Elements[0].Name {
		if !unicode.IsGraphic(r) && !unicode.IsSpace(r) {
			t.Errorf("non-graphic character found: %U", r)
		}
	}
}

// TestRuneCount tests rune counting vs byte counting
func TestRuneCount(t *testing.T) {
	testCases := []struct {
		name      string
		input     string
		runeCount int
		byteCount int
	}{
		{"ascii", "hello", 5, 5},
		{"chinese", "你好", 2, 6},
		{"emoji", "🎉", 1, 4},
		{"mixed", "Hi你好🎉", 5, 12}, // 2 + 6 + 4 = 12 bytes
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if len([]rune(tc.input)) != tc.runeCount {
				t.Errorf("rune count: expected %d, got %d", tc.runeCount, len([]rune(tc.input)))
			}
			if len(tc.input) != tc.byteCount {
				t.Errorf("byte count: expected %d, got %d", tc.byteCount, len(tc.input))
			}
		})
	}
}

// TestFindWithUnicode tests finding elements with Unicode text
func TestFindWithUnicode(t *testing.T) {
	input := `
@e1: button "Hello"
@e2: button "你好"
@e3: button "مرحبا"
@e4: button "🌍"
`
	result := ParseSnapshot(input)

	t.Run("find ascii", func(t *testing.T) {
		found := result.FindElementsByText("Hello")
		if len(found) != 1 {
			t.Errorf("expected 1, got %d", len(found))
		}
	})

	t.Run("find chinese", func(t *testing.T) {
		found := result.FindElementsByText("你好")
		if len(found) != 1 {
			t.Errorf("expected 1, got %d", len(found))
		}
	})

	t.Run("find arabic", func(t *testing.T) {
		found := result.FindElementsByText("مرحبا")
		if len(found) != 1 {
			t.Errorf("expected 1, got %d", len(found))
		}
	})

	t.Run("find emoji", func(t *testing.T) {
		found := result.FindElementsByText("🌍")
		if len(found) != 1 {
			t.Errorf("expected 1, got %d", len(found))
		}
	})

	t.Run("partial chinese", func(t *testing.T) {
		found := result.FindElementsByText("你")
		if len(found) != 1 {
			t.Errorf("expected 1, got %d", len(found))
		}
	})
}

// TestUnicodeInRefs tests that refs only match ASCII patterns
func TestUnicodeInRefs(t *testing.T) {
	testCases := []struct {
		input    string
		expected int
	}{
		{"@e1: button \"Test\"", 1},
		{"@е1: button \"Test\"", 0},  // Cyrillic е, not ASCII e
		{"@e１: button \"Test\"", 0}, // Fullwidth 1
		{"@ｅ1: button \"Test\"", 0}, // Fullwidth e
	}

	for _, tc := range testCases {
		t.Run(tc.input, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != tc.expected {
				t.Errorf("expected %d elements, got %d", tc.expected, len(result.Elements))
			}
		})
	}
}

// TestStringBuilderWithUnicode tests string building with Unicode
func TestStringBuilderWithUnicode(t *testing.T) {
	var builder strings.Builder

	// Build a complex Unicode string
	builder.WriteString("@e1: button \"")
	builder.WriteString("Hello ")
	builder.WriteString("你好 ")
	builder.WriteString("🌍")
	builder.WriteString("\"")

	result := ParseSnapshot(builder.String())
	if len(result.Elements) != 1 {
		t.Errorf("expected 1 element, got %d", len(result.Elements))
	}

	expected := "Hello 你好 🌍"
	if result.Elements[0].Name != expected {
		t.Errorf("expected %q, got %q", expected, result.Elements[0].Name)
	}
}
