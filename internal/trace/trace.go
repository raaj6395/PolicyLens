package trace

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"policylens/internal/model"
)

type Validation struct {
	Check  string `json:"check"`
	Target string `json:"target"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}

type Prompt struct {
	SystemHash    string   `json:"system_hash"`
	SkillSections []string `json:"skill_sections"`
	Examples      []string `json:"examples,omitempty"`
	System        string   `json:"system"`
	User          string   `json:"user"`
}

type Stage struct {
	Name         string       `json:"name"`
	StartedAt    time.Time    `json:"started_at"`
	DurationMS   int64        `json:"duration_ms"`
	InputSummary any          `json:"input_summary,omitempty"`
	Prompt       *Prompt      `json:"prompt,omitempty"`
	RawOutput    []string     `json:"raw_output,omitempty"`
	Parsed       any          `json:"parsed,omitempty"`
	Validations  []Validation `json:"validations"`
	Retries      int          `json:"retries"`
	Skipped      string       `json:"skipped,omitempty"`
	Error        string       `json:"error,omitempty"`
}

type Trace struct {
	TraceID      string          `json:"trace_id"`
	Status       string          `json:"status"`
	CaseID       string          `json:"case_id"`
	SkillVersion string          `json:"skill_version"`
	Provider     string          `json:"provider"`
	Model        string          `json:"model"`
	CreatedAt    time.Time       `json:"created_at"`
	Request      model.Request   `json:"request"`
	Stages       []Stage         `json:"stages"`
	Decision     *model.Decision `json:"decision,omitempty"`
	Result       *model.Result   `json:"result,omitempty"`
	Error        string          `json:"error,omitempty"`
}

func NewPrompt(system, user string, sections, examples []string) *Prompt {
	h := sha256.Sum256([]byte(system))
	return &Prompt{SystemHash: hex.EncodeToString(h[:8]), SkillSections: sections, Examples: examples, System: system, User: user}
}

func Begin(name string) Stage {
	return Stage{Name: name, StartedAt: time.Now(), Validations: []Validation{}}
}

func (s *Stage) End() {
	s.DurationMS = time.Since(s.StartedAt).Milliseconds()
}

func (s *Stage) Check(check, target string, passed bool, detail string) {
	s.Validations = append(s.Validations, Validation{check, target, passed, detail})
}

type Store interface {
	Put(t *Trace)
	Get(id string) ([]byte, bool)
	List() []Summary
}

type Summary struct {
	TraceID        string    `json:"trace_id"`
	Status         string    `json:"status"`
	CaseID         string    `json:"case_id"`
	Model          string    `json:"model"`
	CreatedAt      time.Time `json:"created_at"`
	Service        string    `json:"service,omitempty"`
	Recommendation string    `json:"recommendation,omitempty"`
	Confidence     string    `json:"confidence,omitempty"`
	Error          string    `json:"error,omitempty"`
}

func summarize(b []byte) (Summary, bool) {
	var t Trace
	if json.Unmarshal(b, &t) != nil || t.TraceID == "" {
		return Summary{}, false
	}
	s := Summary{TraceID: t.TraceID, Status: t.Status, CaseID: t.CaseID, Model: t.Model, CreatedAt: t.CreatedAt, Error: t.Error}
	if r := t.Result; r != nil {
		s.Service, s.Recommendation, s.Confidence = r.RequestedService.Description, r.Recommendation, r.Confidence.Level
	}
	return s, true
}

func newest(out []Summary) []Summary {
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

type entry struct {
	data    []byte
	expires time.Time
}

type Memory struct {
	mu  sync.Mutex
	ttl time.Duration
	m   map[string]entry
}

func NewMemory(ttl time.Duration) *Memory {
	return &Memory{ttl: ttl, m: map[string]entry{}}
}

func (s *Memory) Put(t *Trace) {
	b, _ := json.Marshal(t)
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, e := range s.m {
		if now.After(e.expires) {
			delete(s.m, id)
		}
	}
	s.m[t.TraceID] = entry{b, now.Add(s.ttl)}
}

func (s *Memory) Get(id string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.m[id]
	if !ok || time.Now().After(e.expires) {
		return nil, false
	}
	return e.data, true
}

func (s *Memory) List() []Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Summary{}
	for _, e := range s.m {
		if x, ok := summarize(e.data); ok && time.Now().Before(e.expires) {
			out = append(out, x)
		}
	}
	return newest(out)
}

type Disk struct {
	dir string
}

func NewDisk(dir string) (*Disk, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	d := &Disk{dir}
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	for _, f := range files {
		var t Trace
		if b, err := os.ReadFile(f); err == nil && json.Unmarshal(b, &t) == nil && t.Status == "running" {
			t.Status, t.Error = "error", "interrupted by server restart"
			d.Put(&t)
		}
	}
	return d, nil
}

func (d *Disk) path(id string) string {
	return filepath.Join(d.dir, filepath.Base(id)+".json")
}

func (d *Disk) Put(t *Trace) {
	b, _ := json.Marshal(t)
	tmp := d.path(t.TraceID) + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, d.path(t.TraceID))
	}
}

func (d *Disk) Get(id string) ([]byte, bool) {
	b, err := os.ReadFile(d.path(id))
	return b, err == nil
}

func (d *Disk) List() []Summary {
	files, _ := filepath.Glob(filepath.Join(d.dir, "*.json"))
	out := []Summary{}
	for _, f := range files {
		if b, err := os.ReadFile(f); err == nil {
			if x, ok := summarize(b); ok {
				out = append(out, x)
			}
		}
	}
	return newest(out)
}
