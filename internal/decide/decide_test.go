package decide

import (
	"strings"
	"testing"

	"policylens/internal/model"
)

func crit(id, status string, core bool) model.Criterion {
	return model.Criterion{CriterionID: id, Status: status, Core: core}
}

func TestDecide(t *testing.T) {
	tests := []struct {
		name      string
		in        Input
		rec, rule string
		level     string
	}{
		{"all met", Input{Criteria: []model.Criterion{crit("C1", "MET", true), crit("C2", "MET", true)}, PolicySupplied: true}, Approve, "all_met", "HIGH"},
		{"complex case shape", Input{Criteria: []model.Criterion{
			crit("C1", "MET", true), crit("C2", "MET", true), crit("C3", "MET", true),
			crit("C4", "PARTIALLY_MET", true), crit("C5", "PARTIALLY_MET", true), crit("C6", "PARTIALLY_MET", false),
		}, Contradictions: 1, PolicySupplied: true}, MoreInfo, "partial_or_not_assessable", "MEDIUM"},
		{"core unmet beats gaps", Input{Criteria: []model.Criterion{crit("C1", "UNMET", true), crit("C2", "NOT_ASSESSABLE", true)}, PolicySupplied: true}, Deny, "core_unmet", "HIGH"},
		{"non-core unmet pends", Input{Criteria: []model.Criterion{crit("C1", "MET", true), crit("C2", "UNMET", false)}, PolicySupplied: true}, MoreInfo, "partial_or_not_assessable", "HIGH"},
		{"PA-010 admin gap approves", Input{Criteria: []model.Criterion{crit("C1", "MET", true), crit("C2", "NOT_ASSESSABLE", false)}, PolicySupplied: true}, Approve, "core_met_admin_gap", "MEDIUM"},
		{"PA-009 core prerequisite pends", Input{Criteria: []model.Criterion{crit("C1", "MET", true), crit("C2", "NOT_ASSESSABLE", true)}, PolicySupplied: true}, MoreInfo, "partial_or_not_assessable", "HIGH"},
		{"no policy caps LOW", Input{Criteria: []model.Criterion{crit("C1", "UNMET", true)}}, Deny, "core_unmet", "LOW"},
		{"no criteria", Input{PolicySupplied: true}, MoreInfo, "no_criteria", "LOW"},
		{"any-of: one alternative met approves", Input{Criteria: []model.Criterion{
			{CriterionID: "C1", Status: "UNMET", Core: true, AnyOfGroup: "G1"},
			{CriterionID: "C2", Status: "MET", Core: true, AnyOfGroup: "G1"},
			{CriterionID: "C3", Status: "NOT_ASSESSABLE", Core: true, AnyOfGroup: "G1"},
		}, PolicySupplied: true}, Approve, "all_met", "HIGH"},
		{"any-of: all alternatives unmet denies", Input{Criteria: []model.Criterion{
			{CriterionID: "C1", Status: "UNMET", Core: true, AnyOfGroup: "G1"},
			{CriterionID: "C2", Status: "UNMET", Core: true, AnyOfGroup: "G1"},
		}, PolicySupplied: true}, Deny, "core_unmet", "HIGH"},
		{"any-of: best alternative partial pends", Input{Criteria: []model.Criterion{
			{CriterionID: "C1", Status: "UNMET", Core: true, AnyOfGroup: "G1"},
			{CriterionID: "C2", Status: "PARTIALLY_MET", Core: true, AnyOfGroup: "G1"},
			{CriterionID: "C3", Status: "MET", Core: true},
		}, PolicySupplied: true}, MoreInfo, "partial_or_not_assessable", "HIGH"},
		{"dropped quotes capped", Input{Criteria: []model.Criterion{crit("C1", "MET", true)}, DroppedQuotes: 50, PolicySupplied: true}, Approve, "all_met", "HIGH"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := Decide(tt.in)
			if d.Recommendation != tt.rec || d.RuleFired != tt.rule || d.Confidence.Level != tt.level {
				t.Fatalf("got %s/%s/%s (%.2f: %s), want %s/%s/%s", d.Recommendation, d.RuleFired, d.Confidence.Level, d.Confidence.Score, d.Confidence.Rationale, tt.rec, tt.rule, tt.level)
			}
		})
	}
}

func TestBottomLineUsesLabels(t *testing.T) {
	d := Decide(Input{Criteria: []model.Criterion{
		{CriterionID: "C1", Label: "Imaging", Status: "MET", Core: true},
		{CriterionID: "C2", Label: "Therapy tolerance", Status: "UNMET", Core: true},
		{CriterionID: "C3", Label: "OT evaluation", Status: "PARTIALLY_MET", Core: false},
	}, PolicySupplied: true})
	want := "Likely deny: 1 of 2 required criteria is clearly not met (Therapy tolerance). Missing paperwork would not change this."
	if d.BottomLine != want {
		t.Errorf("bottom line = %q, want %q", d.BottomLine, want)
	}
	if !strings.Contains(d.Explanation, "Therapy tolerance") || strings.Contains(d.Explanation, "C2") {
		t.Errorf("explanation should name the label, got %q", d.Explanation)
	}
}
