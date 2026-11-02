package queries

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"policylens/internal/decide"
	"policylens/internal/llm"
	"policylens/internal/model"
	"policylens/internal/trace"
	"policylens/skill"
)

type Gap struct {
	CriterionID   string   `json:"criterion_id,omitempty"`
	SignalGroup   string   `json:"signal_group,omitempty"`
	CriterionText string   `json:"criterion_text,omitempty"`
	Status        string   `json:"status"`
	WhatIsLacking string   `json:"what_is_lacking"`
	EvidenceSoFar []string `json:"evidence_so_far"`
}

func Gaps(a model.Assessment, facts map[string]model.Fact, policySupplied bool) []Gap {
	var gaps []Gap
	for _, c := range a.Criteria {
		if c.Status == "MET" || c.Status == "UNMET" {
			continue
		}
		g := Gap{CriterionID: c.CriterionID, CriterionText: c.CriterionText, Status: c.Status, WhatIsLacking: c.Reasoning, EvidenceSoFar: []string{}}
		for _, e := range c.Evidence {
			for _, s := range facts[e.FactRef].Sources {
				g.EvidenceSoFar = append(g.EvidenceSoFar, fmt.Sprintf("%s (%s): %s", e.FactRef, s.DocID, s.Quote))
			}
		}
		gaps = append(gaps, g)
	}
	for _, s := range a.Signals {
		if !policySupplied && s.Effect == "NOT_FOUND" && s.Group != "contraindication" {
			gaps = append(gaps, Gap{SignalGroup: s.Group, Status: "NOT_FOUND", WhatIsLacking: s.Note, EvidenceSoFar: []string{}})
		}
	}
	return gaps
}

func Run(ctx context.Context, p llm.Provider, sk *skill.Skill, a model.Assessment, d model.Decision, gaps []Gap, facts map[string]model.Fact, exclude []string) (q model.Queries, st trace.Stage, err error) {
	st = trace.Begin("queries")
	defer st.End()
	st.InputSummary = map[string]any{"gaps": gaps, "recommendation": d.Recommendation}
	if d.Recommendation == decide.Approve && len(gaps) == 0 {
		st.Skipped = "LIKELY_APPROVE with no gaps"
		return model.Queries{ProviderQueries: []model.ProviderQuery{}, MissingInformation: []model.MissingInfo{}}, st, nil
	}

	sections := []string{"Role and hard rules", "Provider query style", "Appeal direction style"}
	examples := sk.ExamplesExcluding(exclude)
	var ids []string
	var ex strings.Builder
	ex.WriteString("## Examples of what changes an outcome\n")
	for _, e := range examples {
		ids = append(ids, e.CaseID)
		if e.IfMoreDocs != "" && e.IfMoreDocs != "N/A" {
			fmt.Fprintf(&ex, "- %s (%s, %s): %s\n", e.CaseID, e.Service, e.Recommendation, e.IfMoreDocs)
		}
		if e.ProviderQuery != "" {
			fmt.Fprintf(&ex, "- %s provider query: %s\n- %s flip to approve: %s\n", e.CaseID, e.ProviderQuery, e.CaseID, e.FlipToApprove)
		}
	}
	system := sk.System(sections, exclude, ex.String(), "queries")

	type met struct {
		ID, Text string
		Quotes   []string
	}
	var mets, unmets []met
	for _, c := range a.Criteria {
		if c.Status != "MET" && c.Status != "UNMET" {
			continue
		}
		m := met{ID: c.CriterionID, Text: c.CriterionText}
		for _, e := range c.Evidence {
			for _, s := range facts[e.FactRef].Sources {
				m.Quotes = append(m.Quotes, s.DocID+": "+s.Quote)
			}
		}
		if c.Status == "MET" {
			mets = append(mets, m)
		} else {
			unmets = append(unmets, m)
		}
	}
	gj, _ := json.MarshalIndent(gaps, "", " ")
	mj, _ := json.MarshalIndent(mets, "", " ")
	user := fmt.Sprintf("Requested service: %s (%s)\nRecommendation: %s\nDecision rule: %s\n\n## Criteria met (strongest evidence)\n%s\n\n## Gaps\n%s\n\n",
		a.RequestedService.Description, a.RequestedService.SiteOfCare, d.Recommendation, d.Explanation, mj, gj)
	if len(unmets) > 0 {
		uj, _ := json.MarshalIndent(unmets, "", " ")
		user += fmt.Sprintf("## Criteria documented as not met\nThese are clinical findings, not missing information. Write no provider query and no missing_information item for them; address them only in the appeal direction, naming the clinical change that would have to be documented.\n%s\n\n", uj)
	}
	user += "Write one provider query per criterion gap (and per signal gap that matters for this service), one missing_information item per gap, and the appeal direction."
	st.InputSummary = map[string]any{"gaps": gaps, "not_met": unmets, "recommendation": d.Recommendation}
	st.Prompt = trace.NewPrompt(system, user, sections, ids)

	raws, err := llm.JSON(ctx, p, llm.Request{System: system, User: user, SchemaName: "queries", Schema: sk.Schemas["queries"]},
		func(b []byte) error {
			if err := sk.Validate("queries", b); err != nil {
				return err
			}
			var q model.Queries
			json.Unmarshal(b, &q)
			if len(gaps) > 0 && len(q.ProviderQueries) == 0 {
				return errors.New("provider_queries is empty but there are gaps")
			}
			return nil
		})
	st.RawOutput, st.Retries = raws, max(0, len(raws)-1)
	if len(raws) == 0 || sk.Validate("queries", []byte(raws[len(raws)-1])) != nil {
		if err == nil {
			err = errors.New("no valid output")
		}
		st.Check("schema", "queries", false, err.Error())
		st.Error = err.Error()
		return q, st, err
	}
	st.Check("schema", "queries", true, "")
	json.Unmarshal([]byte(raws[len(raws)-1]), &q)
	criteria := map[string]bool{}
	for _, g := range gaps {
		criteria[g.CriterionID] = true
	}
	for _, pq := range q.ProviderQueries {
		st.Check("query_targets_gap", pq.CriterionID, criteria[pq.CriterionID] || pq.CriterionID == "", "")
	}
	return q, st, nil
}
