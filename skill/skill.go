package skill

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v5"
)

//go:embed SKILL.md VERSION schemas examples
var files embed.FS

type ExampleCriterion struct {
	ID     string `json:"criterion_id"`
	Text   string `json:"criterion_text"`
	Status string `json:"status"`
	Note   string `json:"note,omitempty"`
}

type Example struct {
	CaseID         string             `json:"case_id"`
	Service        string             `json:"requested_service,omitempty"`
	Packet         string             `json:"packet,omitempty"`
	Recommendation string             `json:"recommendation,omitempty"`
	Why            string             `json:"why,omitempty"`
	IfMoreDocs     string             `json:"if_additional_documentation,omitempty"`
	Criteria       []ExampleCriterion `json:"criteria,omitempty"`
	ProviderQuery  string             `json:"provider_query,omitempty"`
	FlipToApprove  string             `json:"flip_to_approve,omitempty"`
}

type Aspect struct {
	Num      int    `json:"num"`
	Category string `json:"category"`
	Aspect   string `json:"aspect"`
}

type Skill struct {
	Version  string                     `json:"version"`
	Markdown string                     `json:"markdown"`
	Schemas  map[string]json.RawMessage `json:"schemas"`
	Examples []Example                  `json:"examples"`
	Aspects  []Aspect                   `json:"aspects"`
	sections map[string]string
	compiled map[string]*jsonschema.Schema
}

func Load() (*Skill, error) {
	v, err := files.ReadFile("VERSION")
	if err != nil {
		return nil, err
	}
	md, err := files.ReadFile("SKILL.md")
	if err != nil {
		return nil, err
	}
	s := &Skill{
		Version:  strings.TrimSpace(string(v)),
		Markdown: string(md),
		Schemas:  map[string]json.RawMessage{},
		sections: splitSections(string(md)),
		compiled: map[string]*jsonschema.Schema{},
	}
	s.Aspects = parseAspects(s.sections["Extraction guide"])
	if len(s.Aspects) != 30 {
		return nil, fmt.Errorf("extraction guide has %d aspects, want 30", len(s.Aspects))
	}
	c := jsonschema.NewCompiler()
	schemaFiles, _ := fs.Glob(files, "schemas/*.json")
	for _, f := range schemaFiles {
		b, _ := files.ReadFile(f)
		name := strings.TrimSuffix(path.Base(f), ".json")
		s.Schemas[name] = b
		if err := c.AddResource(name, bytes.NewReader(b)); err != nil {
			return nil, fmt.Errorf("schema %s: %w", name, err)
		}
	}
	for name := range s.Schemas {
		if s.compiled[name], err = c.Compile(name); err != nil {
			return nil, fmt.Errorf("compile %s: %w", name, err)
		}
	}
	exampleFiles, _ := fs.Glob(files, "examples/*.json")
	for _, f := range exampleFiles {
		b, _ := files.ReadFile(f)
		var e Example
		if err := json.Unmarshal(b, &e); err != nil {
			return nil, fmt.Errorf("example %s: %w", f, err)
		}
		s.Examples = append(s.Examples, e)
	}
	return s, nil
}

func splitSections(md string) map[string]string {
	out := map[string]string{}
	var title string
	var buf strings.Builder
	flush := func() {
		if title != "" {
			out[title] = strings.TrimSpace(buf.String())
		}
		buf.Reset()
	}
	for line := range strings.SplitSeq(md, "\n") {
		if t, ok := strings.CutPrefix(line, "## "); ok {
			flush()
			title = strings.TrimSpace(t)
			continue
		}
		buf.WriteString(line + "\n")
	}
	flush()
	return out
}

func (s *Skill) Section(title string, exclude []string) string {
	var b strings.Builder
	for line := range strings.SplitSeq(s.sections[title], "\n") {
		if !mentionsAny(line, exclude) {
			b.WriteString(line + "\n")
		}
	}
	return "## " + title + "\n\n" + strings.TrimSpace(b.String())
}

func (s *Skill) System(sections, exclude []string, extra, schemaName string) string {
	var parts []string
	for _, t := range sections {
		parts = append(parts, s.Section(t, exclude))
	}
	if extra != "" {
		parts = append(parts, extra)
	}
	parts = append(parts, "## Output\n\nReturn only one JSON object, no prose, matching this JSON Schema:\n"+string(s.Schemas[schemaName]))
	return strings.Join(parts, "\n\n")
}

func (s *Skill) ExamplesExcluding(exclude []string) []Example {
	var out []Example
	for _, e := range s.Examples {
		if !slices.Contains(exclude, e.CaseID) {
			out = append(out, e)
		}
	}
	return out
}

func (s *Skill) Validate(name string, raw []byte) error {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return s.compiled[name].Validate(v)
}

func parseAspects(section string) []Aspect {
	var out []Aspect
	for line := range strings.SplitSeq(section, "\n") {
		cells := strings.Split(strings.Trim(line, "| "), "|")
		if len(cells) < 3 {
			continue
		}
		n, err := strconv.Atoi(strings.TrimSpace(cells[0]))
		if err != nil {
			continue
		}
		out = append(out, Aspect{n, strings.TrimSpace(cells[1]), strings.TrimSpace(cells[2])})
	}
	return out
}

func mentionsAny(line string, ids []string) bool {
	for _, id := range ids {
		if id != "" && strings.Contains(line, id) {
			return true
		}
	}
	return false
}
