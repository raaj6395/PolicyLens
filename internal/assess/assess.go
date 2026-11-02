package assess

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"policylens/internal/llm"
	"policylens/internal/model"
	"policylens/internal/trace"
	"policylens/internal/validate"
	"policylens/skill"
)

func Run(ctx context.Context, p llm.Provider, sk *skill.Skill, fs model.FactSheet, policy *model.Policy, exclude []string) (a model.Assessment, st trace.Stage, err error) {
	st = trace.Begin("assess")
	defer st.End()

	sections := []string{"Role and hard rules", "Source hierarchy", "Criteria status definitions", "Patterns learned from training cases"}
	if policy == nil {
		sections = append(sections, "No-policy fallback")
	}
	examples := sk.ExamplesExcluding(exclude)
	var ids []string
	for _, e := range examples {
		ids = append(ids, e.CaseID)
	}
	system := sk.System(sections, exclude, RenderExamples(examples), "assessment")
	user := policyBlock(policy) + "\n\n## Patient Fact Sheet\n\n" + factsJSON(fs) + reportedGaps(fs) +
		"\n\nAssess this case: identify signals, split the policy into criteria and judge each one (evidence, then reasoning, then status), and list contradictions. Cite only fact_ids from the fact sheet."
	st.Prompt = trace.NewPrompt(system, user, sections, ids)
	st.InputSummary = map[string]any{"facts": len(fs.Facts), "policy_supplied": policy != nil, "excluded_examples": exclude}

	facts := Index(fs)
	raws, err := llm.JSON(ctx, p, llm.Request{System: system, User: user, SchemaName: "assessment", Schema: sk.Schemas["assessment"]},
		func(b []byte) error {
			if err := sk.Validate("assessment", b); err != nil {
				return err
			}
			var a model.Assessment
			if err := json.Unmarshal(b, &a); err != nil {
				return err
			}
			issues := validate.AssessmentIssues(&a, facts)
			if policy != nil {
				if s := validate.AlternativesIssue(policy.Text, &a); s != "" {
					issues = append(issues, s)
				}
			}
			if len(issues) > 0 {
				return errors.New(strings.Join(issues, "; "))
			}
			return nil
		})
	st.RawOutput, st.Retries = raws, max(0, len(raws)-1)
	if len(raws) == 0 {
		st.Error = err.Error()
		return a, st, err
	}
	last := []byte(raws[len(raws)-1])
	if serr := sk.Validate("assessment", last); serr != nil {
		st.Check("schema", "assessment", false, serr.Error())
		st.Error = serr.Error()
		return a, st, serr
	}
	st.Check("schema", "assessment", true, "")
	json.Unmarshal(last, &a)
	if err != nil {
		st.Check("semantic_after_retry", "assessment", false, "repairing in code: "+err.Error())
	}
	return a, st, nil
}

func reportedGaps(fs model.FactSheet) string {
	var b strings.Builder
	for _, f := range fs.Facts {
		if f.Aspect != "Missing records" || f.Status == "MISSING" {
			continue
		}
		for _, s := range f.Sources {
			fmt.Fprintf(&b, "- %s (%s): %s\n", f.FactID, s.DocID, s.Quote)
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return "\n\n## Documentation gaps reported by the packet\n\nFor every criterion whose own element is named in one of these, cite that fact_id in the criterion's evidence; such a criterion is at most PARTIALLY_MET. A form gap (blank signature or date, missing NPI, unfilled field) belongs only to the final prerequisites criterion.\n" + b.String()
}

func Index(fs model.FactSheet) map[string]model.Fact {
	m := map[string]model.Fact{}
	for _, f := range fs.Facts {
		m[f.FactID] = f
	}
	return m
}

func policyBlock(p *model.Policy) string {
	if p == nil || strings.TrimSpace(p.Text) == "" {
		return "## Payer policy\n\nNO POLICY SUPPLIED. Apply the No-policy fallback."
	}
	return fmt.Sprintf("## Payer policy: %s\n\n%s", p.Name, p.Text)
}

func factsJSON(fs model.FactSheet) string {
	type src struct {
		DocID string `json:"doc_id"`
		Quote string `json:"quote"`
		Value string `json:"value,omitempty"`
	}
	type fact struct {
		ID      string `json:"fact_id"`
		Aspect  string `json:"aspect"`
		Status  string `json:"status"`
		Value   string `json:"value,omitempty"`
		Sources []src  `json:"sources,omitempty"`
	}
	var out []fact
	for _, f := range fs.Facts {
		x := fact{ID: f.FactID, Aspect: f.Aspect, Status: f.Status, Value: f.Value}
		for _, s := range f.Sources {
			x.Sources = append(x.Sources, src{s.DocID, s.Quote, s.Value})
		}
		out = append(out, x)
	}
	b, _ := json.MarshalIndent(out, "", " ")
	return string(b)
}

func RenderExamples(examples []skill.Example) string {
	if len(examples) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Labeled examples from past reviews\n\nThese show how outcomes were reached. They are not the current case; never copy facts from them.\n")
	for _, e := range examples {
		fmt.Fprintf(&b, "\n### %s: %s\n", e.CaseID, e.Service)
		if e.Packet != "" {
			fmt.Fprintf(&b, "Packet: %s\n", e.Packet)
		}
		for _, c := range e.Criteria {
			fmt.Fprintf(&b, "- %s %s: %s (%s)\n", c.ID, c.Text, c.Status, c.Note)
		}
		fmt.Fprintf(&b, "Outcome: %s. Why: %s\n", e.Recommendation, e.Why)
	}
	return b.String()
}
