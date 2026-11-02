package pipeline

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"policylens/internal/assess"
	"policylens/internal/decide"
	"policylens/internal/extract"
	"policylens/internal/llm"
	"policylens/internal/model"
	"policylens/internal/queries"
	"policylens/internal/trace"
	"policylens/internal/validate"
	"policylens/skill"
)

const (
	maxDocs     = 50
	maxDocChars = 100_000
)

var ErrInvalid = errors.New("invalid request")

type Pipeline struct {
	Skill       *skill.Skill
	Store       trace.Store
	NewProvider func(name string) (llm.Provider, error)
}

func (p *Pipeline) Start(req model.Request) (*trace.Trace, llm.Provider, error) {
	st := trace.Begin("ingest")
	if len(req.Documents) == 0 {
		return nil, nil, fmt.Errorf("%w: documents is required", ErrInvalid)
	}
	if len(req.Documents) > maxDocs {
		return nil, nil, fmt.Errorf("%w: at most %d documents", ErrInvalid, maxDocs)
	}
	for i := range req.Documents {
		d := &req.Documents[i]
		if strings.TrimSpace(d.Text) == "" {
			return nil, nil, fmt.Errorf("%w: documents[%d].text is empty", ErrInvalid, i)
		}
		if len(d.Text) > maxDocChars {
			return nil, nil, fmt.Errorf("%w: documents[%d].text exceeds %d characters", ErrInvalid, i, maxDocChars)
		}
		d.ID = fmt.Sprintf("D%d", i+1)
		if d.Name == "" {
			d.Name = "Document " + d.ID
		}
		st.Check("document_ok", d.ID, true, d.Name)
	}
	if req.Policy != nil && strings.TrimSpace(req.Policy.Text) == "" {
		req.Policy = nil
	}
	st.Check("policy_supplied", "policy", req.Policy != nil, map[bool]string{true: "judging against supplied policy", false: "no policy: fallback applies, confidence capped LOW"}[req.Policy != nil])
	if req.CaseID == "" {
		req.CaseID = "AD-HOC"
	}
	prov, err := p.NewProvider(req.Options.Provider)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	st.InputSummary = map[string]any{"documents": len(req.Documents), "policy_supplied": req.Policy != nil}
	st.Parsed = req.Documents
	st.End()
	t := &trace.Trace{
		TraceID:      newID(),
		Status:       "running",
		CaseID:       req.CaseID,
		SkillVersion: p.Skill.Version,
		Provider:     prov.Name(),
		Model:        prov.Model(),
		CreatedAt:    time.Now(),
		Request:      req,
		Stages:       []trace.Stage{st},
	}
	p.Store.Put(t)
	return t, prov, nil
}

func (p *Pipeline) Run(ctx context.Context, t *trace.Trace, prov llm.Provider) error {
	err := p.run(ctx, t, prov)
	if err != nil {
		t.Status, t.Error = "error", err.Error()
	} else {
		t.Status = "done"
	}
	slog.Info("assess", "trace_id", t.TraceID, "case_id", t.CaseID, "status", t.Status, "provider", t.Provider, "model", t.Model)
	p.Store.Put(t)
	return err
}

func (p *Pipeline) run(ctx context.Context, t *trace.Trace, prov llm.Provider) error {
	req := t.Request
	exclude := req.Options.ExcludeExamples
	add := func(st trace.Stage) {
		t.Stages = append(t.Stages, st)
		p.Store.Put(t)
	}
	docs := map[string]model.Document{}
	for _, d := range req.Documents {
		docs[d.ID] = d
	}

	fs, st, err := extract.Run(ctx, prov, p.Skill, req.Documents, req.Policy)
	add(st)
	if err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	vst := trace.Begin("validate_facts")
	dropped := validate.Facts(&fs, docs, p.Skill.Aspects, &vst)
	counts := map[string]int{}
	for _, f := range fs.Facts {
		counts[f.Status]++
	}
	vst.InputSummary = map[string]any{"status_counts": counts, "dropped_quotes": dropped}
	vst.Parsed = fs
	vst.End()
	add(vst)

	a, st, err := assess.Run(ctx, prov, p.Skill, fs, req.Policy, exclude)
	add(st)
	if err != nil {
		return fmt.Errorf("assess: %w", err)
	}
	facts := assess.Index(fs)
	vst = trace.Begin("validate_assessment")
	validate.RepairAssessment(&a, facts, req.Policy != nil, &vst)
	vst.Parsed = a
	vst.End()
	add(vst)

	dst := trace.Begin("decide")
	in := decide.Input{Criteria: a.Criteria, Contradictions: len(a.Contradictions), DroppedQuotes: dropped, PolicySupplied: req.Policy != nil}
	d := decide.Decide(in)
	dst.InputSummary, dst.Parsed = in, d
	dst.Check("rule_fired", d.RuleFired, true, d.Explanation)
	dst.End()
	t.Decision = &d
	add(dst)

	gaps := queries.Gaps(a, facts, req.Policy != nil)
	q, st, err := queries.Run(ctx, prov, p.Skill, a, d, gaps, facts, exclude)
	add(st)
	if err != nil {
		return fmt.Errorf("queries: %w", err)
	}

	ast := trace.Begin("assemble")
	r := Assemble(t, fs, a, d, q, docs)
	ast.Parsed = r
	ast.End()
	t.Result = &r
	t.Stages = append(t.Stages, ast)
	return nil
}

func Assemble(t *trace.Trace, fs model.FactSheet, a model.Assessment, d model.Decision, q model.Queries, docs map[string]model.Document) model.Result {
	facts := assess.Index(fs)
	evidence := func(refs []string) []model.Evidence {
		out := []model.Evidence{}
		seen := map[string]bool{}
		for _, ref := range refs {
			for _, s := range facts[ref].Sources {
				k := ref + s.DocID + s.Quote
				if seen[k] {
					continue
				}
				seen[k] = true
				out = append(out, model.Evidence{FactID: ref, SourceDoc: docs[s.DocID].Name, DocID: s.DocID, Snippet: s.Quote, Span: s.Span})
			}
		}
		return out
	}
	r := model.Result{
		TraceID:            t.TraceID,
		SkillVersion:       t.SkillVersion,
		Provider:           t.Provider,
		Model:              t.Model,
		CaseID:             t.CaseID,
		RequestedService:   a.RequestedService,
		BottomLine:         d.BottomLine,
		ClinicalSummary:    a.ClinicalSummary,
		CriteriaAssessment: []model.CriterionResult{},
		CriteriaMet:        []string{},
		CriteriaNotMet:     []string{},
		SupportingFactors:  a.SupportingFactors,
		WeakeningFactors:   a.WeakeningFactors,
		Contradictions:     []model.ContradictionResult{},
		MissingInformation: q.MissingInformation,
		NecessityCategory:  d.NecessityCategory,
		Recommendation:     d.Recommendation,
		WorkflowState:      d.WorkflowState,
		Confidence:         d.Confidence,
		ProviderQueries:    q.ProviderQueries,
		AppealDirection:    q.AppealDirection,
		PolicyUsed:         "none supplied (no-policy fallback)",
	}
	if t.Request.Policy != nil {
		r.PolicyUsed = t.Request.Policy.Name
	}
	for _, c := range a.Criteria {
		var refs []string
		for _, e := range c.Evidence {
			refs = append(refs, e.FactRef)
		}
		r.CriteriaAssessment = append(r.CriteriaAssessment, model.CriterionResult{
			CriterionID: c.CriterionID, Label: c.Label, CriterionText: c.CriterionText, Core: c.Core, AnyOfGroup: c.AnyOfGroup, Status: c.Status, Reasoning: c.Reasoning, Evidence: evidence(refs),
		})
		if c.Status == "MET" {
			r.CriteriaMet = append(r.CriteriaMet, c.CriterionID)
		} else {
			r.CriteriaNotMet = append(r.CriteriaNotMet, c.CriterionID)
		}
	}
	for _, c := range a.Contradictions {
		ev := evidence(c.FactRefs)
		var names []string
		seen := map[string]bool{}
		for _, e := range ev {
			if !seen[e.SourceDoc] {
				seen[e.SourceDoc] = true
				names = append(names, e.SourceDoc)
			}
		}
		r.Contradictions = append(r.Contradictions, model.ContradictionResult{Issue: c.Issue, Sources: names, PreferredSource: c.PreferredSource, Why: c.Why, Evidence: ev})
	}
	return r
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
