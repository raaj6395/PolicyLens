package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"policylens/data"
	"policylens/internal/llm"
	"policylens/internal/model"
	"policylens/internal/pipeline"
	"policylens/internal/trace"
	"policylens/skill"
)

var labels = []string{"LIKELY_APPROVE", "NEED_MORE_INFO", "LIKELY_DENY"}

type CriterionCheck struct {
	ID       string `json:"criterion_id"`
	Expected string `json:"expected_text"`
	Got      string `json:"got_text"`
	Want     string `json:"want_status"`
	Status   string `json:"got_status"`
	Match    bool   `json:"match"`
}

type CaseResult struct {
	CaseID     string           `json:"case_id"`
	Title      string           `json:"title"`
	Expected   string           `json:"expected"`
	Why        string           `json:"expected_why,omitempty"`
	Got        string           `json:"got"`
	Correct    bool             `json:"correct"`
	RuleFired  string           `json:"rule_fired,omitempty"`
	Confidence model.Confidence `json:"confidence"`
	Criteria   []CriterionCheck `json:"criteria_comparison,omitempty"`
	Statuses   []string         `json:"criteria_statuses"`
	TraceID    string           `json:"trace_id"`
	DurationMS int64            `json:"duration_ms"`
	Error      string           `json:"error,omitempty"`
}

type Report struct {
	Mode                string                    `json:"mode"`
	GeneratedAt         time.Time                 `json:"generated_at"`
	SkillVersion        string                    `json:"skill_version"`
	Provider            string                    `json:"provider"`
	Model               string                    `json:"model"`
	Cases               []CaseResult              `json:"cases"`
	Accuracy            float64                   `json:"accuracy"`
	Correct             int                       `json:"correct"`
	Total               int                       `json:"total"`
	Labels              []string                  `json:"labels"`
	Confusion           map[string]map[string]int `json:"confusion"`
	MoreInfoDenyConfuse int                       `json:"more_info_vs_deny_confusions"`
}

func main() {
	only := flag.String("case", "", "run only this case_id")
	provider := flag.String("provider", "", "LLM provider (default from env)")
	mode := flag.String("mode", "loo", "loo: withhold each case's own example and pattern; insample: keep them (checks the skill encodes the trends); synthetic: run the authored SYN- cases")
	flag.Parse()
	if err := llm.LoadDotEnv(".env"); err != nil {
		log.Fatal(err)
	}

	sk, err := skill.Load()
	if err != nil {
		log.Fatal(err)
	}
	fixtures, err := data.Fixtures()
	if err != nil {
		log.Fatal(err)
	}
	p := &pipeline.Pipeline{Skill: sk, Store: trace.NewMemory(time.Hour), NewProvider: llm.New}
	os.MkdirAll("data/eval/traces", 0o755)

	rep := Report{Mode: *mode, GeneratedAt: time.Now().UTC(), SkillVersion: sk.Version, Labels: labels, Confusion: map[string]map[string]int{}}
	for _, l := range labels {
		rep.Confusion[l] = map[string]int{}
	}
	for _, f := range fixtures {
		if strings.HasPrefix(f.Request.CaseID, "SYN-") != (*mode == "synthetic") {
			continue
		}
		if *only != "" && f.Request.CaseID != *only {
			continue
		}
		req := f.Request
		if *mode == "loo" && !slices.Contains(req.Options.ExcludeExamples, req.CaseID) {
			req.Options.ExcludeExamples = append(slices.Clone(req.Options.ExcludeExamples), req.CaseID)
		}
		if *provider != "" {
			req.Options.Provider = *provider
		}
		start := time.Now()
		t, prov, err := p.Start(req)
		if err != nil {
			log.Fatal(err)
		}
		rep.Provider, rep.Model = prov.Name(), prov.Model()
		fmt.Printf("%-16s running... ", f.Request.CaseID)
		runErr := p.Run(context.Background(), t, prov)
		cr := CaseResult{CaseID: f.Request.CaseID, Title: f.Title, Expected: f.Expected.Recommendation, Why: f.Expected.Why, TraceID: t.TraceID, DurationMS: time.Since(start).Milliseconds(), Statuses: []string{}}
		if runErr != nil {
			cr.Error = runErr.Error()
		} else {
			r := t.Result
			cr.Got, cr.RuleFired, cr.Confidence = r.Recommendation, t.Decision.RuleFired, r.Confidence
			cr.Correct = cr.Got == cr.Expected
			for _, c := range r.CriteriaAssessment {
				cr.Statuses = append(cr.Statuses, c.CriterionID+"="+c.Status)
			}
			got := map[string]model.CriterionResult{}
			for _, c := range r.CriteriaAssessment {
				got[c.CriterionID] = c
			}
			for _, want := range f.Expected.Criteria {
				g := got[want.ID]
				cr.Criteria = append(cr.Criteria, CriterionCheck{want.ID, want.Text, g.CriterionText, want.Status, g.Status, want.Status == g.Status})
			}
		}
		writeJSON(filepath.Join("data/eval/traces", t.TraceID+".json"), t)
		fmt.Printf("expected=%s got=%s %s (%ds)\n", cr.Expected, cr.Got, map[bool]string{true: "OK", false: "MISS"}[cr.Correct], cr.DurationMS/1000)
		rep.Total++
		if cr.Correct {
			rep.Correct++
		}
		if cr.Got != "" {
			rep.Confusion[cr.Expected][cr.Got]++
		}
		if (cr.Expected == "NEED_MORE_INFO" && cr.Got == "LIKELY_DENY") || (cr.Expected == "LIKELY_DENY" && cr.Got == "NEED_MORE_INFO") {
			rep.MoreInfoDenyConfuse++
		}
		rep.Cases = append(rep.Cases, cr)
	}
	if rep.Total > 0 {
		rep.Accuracy = float64(rep.Correct) / float64(rep.Total)
	}
	if *only == "" {
		writeJSON("data/eval/report_"+*mode+".json", rep)
		os.WriteFile("docs/eval_results_"+*mode+".md", []byte(summary(rep)), 0o644)
	}
	fmt.Printf("accuracy %d/%d, NEED_MORE_INFO<->DENY confusions: %d\n", rep.Correct, rep.Total, rep.MoreInfoDenyConfuse)
}

func writeJSON(path string, v any) {
	b, _ := json.MarshalIndent(v, "", "  ")
	if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
}

func summary(rep Report) string {
	var b strings.Builder
	how := map[string]string{
		"loo":      "Leave-one-out: each training case's own example and SKILL.md pattern are withheld while it runs. This measures how the skill generalizes to an unseen case.",
		"synthetic": "Synthetic: cases authored after the skill was built (not from the workbook), each with a synthetic payer policy and 3-6 documents. Expected labels are the author's judgment, not workbook ground truth.",
		"insample": "In-sample: every example and pattern is available (the complex case still withholds PA-001). This checks that the skill encodes the learned trends; it is not a generalization score.",
	}[rep.Mode]
	fmt.Fprintf(&b, "# Eval Results (%s)\n\nGenerated by `go run ./cmd/eval -mode %s` on %s. Skill %s, provider `%s`, model `%s`. %s\n\n",
		rep.Mode, rep.Mode, rep.GeneratedAt.Format("2006-01-02 15:04 UTC"), rep.SkillVersion, rep.Provider, rep.Model, how)
	fmt.Fprintf(&b, "**Label accuracy: %d/%d (%.0f%%)**. NEED_MORE_INFO ↔ LIKELY_DENY confusions: **%d**.\n\n", rep.Correct, rep.Total, rep.Accuracy*100, rep.MoreInfoDenyConfuse)
	b.WriteString("## Confusion matrix (rows = expected, columns = got)\n\n| | APPROVE | MORE_INFO | DENY |\n|---|---|---|---|\n")
	for _, e := range rep.Labels {
		fmt.Fprintf(&b, "| %s | %d | %d | %d |\n", e, rep.Confusion[e][labels[0]], rep.Confusion[e][labels[1]], rep.Confusion[e][labels[2]])
	}
	b.WriteString("\n## Per case\n\n| Case | Expected | Got | | Rule | Confidence | Criteria |\n|---|---|---|---|---|---|---|\n")
	for _, c := range rep.Cases {
		mark := "✅"
		if !c.Correct {
			mark = "❌"
		}
		got := c.Got
		if c.Error != "" {
			got = "error: " + c.Error
		}
		fmt.Fprintf(&b, "| %s | %s | %s | %s | %s | %s %.2f | %s |\n", c.CaseID, c.Expected, got, mark, c.RuleFired, c.Confidence.Level, c.Confidence.Score, strings.Join(c.Statuses, ", "))
	}
	var misses []CaseResult
	for _, c := range rep.Cases {
		if !c.Correct && c.Why != "" {
			misses = append(misses, c)
		}
	}
	if len(misses) > 0 {
		b.WriteString("\n## Misses: what the case was designed to test\n\n")
		for _, c := range misses {
			fmt.Fprintf(&b, "- **%s** expected %s, got %s (rule `%s`). Designed to test: %s\n", c.CaseID, c.Expected, c.Got, c.RuleFired, c.Why)
		}
	}
	for _, c := range rep.Cases {
		if len(c.Criteria) == 0 {
			continue
		}
		fmt.Fprintf(&b, "\n## %s per-criterion comparison\n\n| ID | Expected criterion | Skill's criterion | Want | Got | |\n|---|---|---|---|---|---|\n", c.CaseID)
		for _, k := range c.Criteria {
			fmt.Fprintf(&b, "| %s | %s | %s | %s | %s | %s |\n", k.ID, k.Expected, k.Got, k.Want, k.Status, map[bool]string{true: "✅", false: "❌"}[k.Match])
		}
	}
	return b.String()
}
