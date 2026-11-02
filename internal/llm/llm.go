package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type Request struct {
	System     string
	User       string
	SchemaName string
	Schema     json.RawMessage
}

type Provider interface {
	Name() string
	Model() string
	Complete(ctx context.Context, r Request) (string, error)
}

type preset struct {
	baseURL, model, keyEnv string
	strict                 bool
}

var presets = map[string]preset{
	"gemini": {"https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash", "GEMINI_API_KEY", true},
	"openai": {"https://api.openai.com/v1", "gpt-4.1", "OPENAI_API_KEY", false},
	"groq":   {"https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", "GROQ_API_KEY", false},
	"ollama": {"http://localhost:11434/v1", "gpt-oss:120b-cloud", "", false},
}

func DefaultProvider() string {
	if p := os.Getenv("LLM_PROVIDER"); p != "" {
		return p
	}
	switch {
	case os.Getenv("OPENAI_API_KEY") != "":
		return "openai"
	case os.Getenv("GEMINI_API_KEY") != "":
		return "gemini"
	case os.Getenv("GROQ_API_KEY") != "":
		return "groq"
	}
	return "openai"
}

func New(name string) (Provider, error) {
	if name == "" {
		name = DefaultProvider()
	}
	p, ok := presets[name]
	if !ok {
		return nil, fmt.Errorf("unknown provider %q (gemini, openai, groq, ollama)", name)
	}
	c := &compat{name: name, baseURL: p.baseURL, model: p.model, strict: p.strict, client: &http.Client{Timeout: 5 * time.Minute}}
	if m := os.Getenv("LLM_MODEL"); m != "" && name == DefaultProvider() {
		c.model = m
	}
	if u := os.Getenv("LLM_BASE_URL"); u != "" && name == DefaultProvider() {
		c.baseURL = u
	}
	if p.keyEnv != "" {
		if c.key = os.Getenv(p.keyEnv); c.key == "" {
			return nil, fmt.Errorf("%s is not set", p.keyEnv)
		}
	}
	return c, nil
}

type compat struct {
	name, model, baseURL, key string
	strict                    bool
	client                    *http.Client
}

func (c *compat) Name() string  { return c.name }
func (c *compat) Model() string { return c.model }

func (c *compat) Complete(ctx context.Context, r Request) (string, error) {
	format := map[string]any{"type": "json_object"}
	if c.strict && r.Schema != nil {
		format = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": r.SchemaName, "schema": wireSchema(r.Schema)}}
	}
	payload := map[string]any{
		"model":           c.model,
		"response_format": format,
		"messages": []map[string]string{
			{"role": "system", "content": r.System},
			{"role": "user", "content": r.User},
		},
	}
	if !fixedTemperature(c.model) {
		payload["temperature"] = 0
	}
	body, _ := json.Marshal(payload)
	var lastErr error
	for attempt := range 4 {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(time.Duration(attempt*attempt) * 3 * time.Second):
			}
		}
		out, retryable, err := c.post(ctx, body)
		if err == nil {
			return out, nil
		}
		lastErr = err
		if !retryable {
			break
		}
	}
	return "", lastErr
}

func (c *compat) post(ctx context.Context, body []byte) (string, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return "", ctx.Err() == nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		retryable := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
		return "", retryable, fmt.Errorf("%s %d: %s", c.name, resp.StatusCode, truncate(string(b), 300))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil || len(parsed.Choices) == 0 {
		return "", true, fmt.Errorf("%s: unexpected response: %s", c.name, truncate(string(b), 300))
	}
	return stripFences(parsed.Choices[0].Message.Content), false, nil
}

func fixedTemperature(model string) bool {
	for _, p := range []string{"o1", "o3", "o4", "gpt-5"} {
		if strings.HasPrefix(model, p) {
			return true
		}
	}
	return false
}

func wireSchema(raw json.RawMessage) any {
	var v any
	json.Unmarshal(raw, &v)
	var strip func(any) any
	strip = func(v any) any {
		switch t := v.(type) {
		case map[string]any:
			for _, k := range []string{"$schema", "additionalProperties", "pattern"} {
				delete(t, k)
			}
			for k, x := range t {
				t[k] = strip(x)
			}
		case []any:
			for i, x := range t {
				t[i] = strip(x)
			}
		}
		return v
	}
	return strip(v)
}

func stripFences(s string) string {
	s = strings.TrimSpace(s)
	if rest, ok := strings.CutPrefix(s, "```"); ok {
		rest = strings.TrimPrefix(rest, "json")
		s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(rest), "```"))
	}
	return s
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}

func JSON(ctx context.Context, p Provider, r Request, validate func([]byte) error) ([]string, error) {
	var raws []string
	base := r.User
	for attempt := range 2 {
		out, err := p.Complete(ctx, r)
		if err != nil {
			return raws, err
		}
		raws = append(raws, out)
		verr := validate([]byte(out))
		if verr == nil {
			return raws, nil
		}
		if attempt == 1 {
			return raws, errors.New("output failed validation after retry: " + truncate(verr.Error(), 1000))
		}
		r.User = base + "\n\nYour previous output failed validation:\n" + truncate(verr.Error(), 2000) +
			"\n\nPrevious output:\n" + truncate(out, 12000) + "\n\nReturn the corrected JSON only."
	}
	return raws, nil
}
