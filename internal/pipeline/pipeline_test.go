package pipeline

import (
	"context"
	"testing"
	"time"

	"policylens/internal/llm"
	"policylens/internal/model"
	"policylens/internal/trace"
	"policylens/skill"
)

type fake struct{ calls map[string]int }

func (f *fake) Name() string  { return "fake" }
func (f *fake) Model() string { return "fake-1" }

func (f *fake) Complete(_ context.Context, r llm.Request) (string, error) {
	f.calls[r.SchemaName]++
	switch r.SchemaName {
	case "fact_sheet":
		return `{"facts":[
			{"fact_id":"F20","category":"Diagnostics","aspect":"Imaging findings","value":"severe stenosis","status":"FOUND","sources":[{"doc_id":"D2","quote":"Severe C5-C6 canal stenosis with cord compression","value":"severe"}]},
			{"fact_id":"F11","category":"Clinical severity","aspect":"Functional impairment / ADLs","value":"buttoning","status":"FOUND","sources":[{"doc_id":"D1","quote":"cannot button shirt at all","value":"x"}]}
		]}`, nil
	case "assessment":
		if f.calls["assessment"] == 1 {
			return `{"requested_service":{"description":"fusion","codes":[],"site_of_care":"inpatient"},"clinical_summary":"s","request_conflict":{"present":false,"detail":""},"signals":[],"criteria":[{"criterion_id":"C1","label":"Imaging","criterion_text":"imaging","core":true,"any_of_group":"","evidence":[{"fact_ref":"F99","quote":"x"}],"reasoning":"r","status":"MET"}],"contradictions":[],"supporting_factors":[],"weakening_factors":[]}`, nil
		}
		return `{"requested_service":{"description":"fusion","codes":[],"site_of_care":"inpatient"},"clinical_summary":"s","request_conflict":{"present":false,"detail":""},"signals":[],"criteria":[
			{"criterion_id":"C1","label":"Imaging","criterion_text":"imaging","core":true,"any_of_group":"","evidence":[{"fact_ref":"F20","quote":"x"}],"reasoning":"r","status":"MET"},
			{"criterion_id":"C2","label":"Function","criterion_text":"function","core":true,"any_of_group":"","evidence":[{"fact_ref":"F11","quote":"x"}],"reasoning":"r","status":"PARTIALLY_MET"}
		],"contradictions":[],"supporting_factors":[],"weakening_factors":[]}`, nil
	case "queries":
		return `{"provider_queries":[{"criterion_id":"C2","question":"q","requested_document":"addendum"}],"missing_information":[],"appeal_direction":"a"}`, nil
	}
	return "{}", nil
}

func TestPipeline(t *testing.T) {
	sk, err := skill.Load()
	if err != nil {
		t.Fatal(err)
	}
	f := &fake{calls: map[string]int{}}
	p := &Pipeline{Skill: sk, Store: trace.NewMemory(time.Minute), NewProvider: func(string) (llm.Provider, error) { return f, nil }}
	tr, prov, err := p.Start(model.Request{CaseID: "T1", Documents: []model.Document{
		{Name: "PT note", Text: "ADL impact: Difficulty buttoning shirt."},
		{Name: "MRI", Text: "MRI cervical spine: Severe C5-C6 canal stenosis with cord compression."},
	}, Policy: &model.Policy{Name: "P", Text: "Requires imaging correlation and functional impairment."}})
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Run(context.Background(), tr, prov); err != nil {
		t.Fatal(err)
	}
	r := tr.Result
	if r.Recommendation != "NEED_MORE_INFO" || f.calls["assessment"] != 2 {
		t.Fatalf("rec=%s assessment calls=%d", r.Recommendation, f.calls["assessment"])
	}
	c1 := r.CriteriaAssessment[0]
	if len(c1.Evidence) != 1 || c1.Evidence[0].DocID != "D2" || c1.Evidence[0].Snippet != "Severe C5-C6 canal stenosis with cord compression" {
		t.Fatalf("C1 evidence = %+v", c1.Evidence)
	}
	if c2 := r.CriteriaAssessment[1]; len(c2.Evidence) != 0 {
		t.Fatalf("hallucinated quote survived: %+v", c2.Evidence)
	}
	if _, ok := p.Store.Get(tr.TraceID); !ok || tr.Status != "done" {
		t.Fatal("trace not stored as done")
	}
}
