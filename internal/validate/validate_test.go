package validate

import (
	"strings"
	"testing"

	"policylens/internal/model"
	"policylens/internal/trace"
)

const mri = "MRI cervical spine: Severe C5-C6 canal stenosis with cord compression and T2 cord signal change; moderate foraminal narrowing."

func TestFindQuote(t *testing.T) {
	tests := []struct {
		quote, match string
		ok           bool
	}{
		{"Severe C5-C6 canal stenosis with cord compression", "exact", true},
		{"severe c5 c6 canal stenosis, with cord compression", "exact", true},
		{"Severe  C5-C6\ncanal   stenosis", "exact", true},
		{"Severe C5-C6 canal stenosis with spinal cord compression and T2 cord signal change", "fuzzy", true},
		{"Mild C5-C6 stenosis without cord compression", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		span, match, ok := FindQuote(mri, tt.quote)
		if ok != tt.ok || match != tt.match {
			t.Errorf("%q: got %v %q, want %v %q", tt.quote, ok, match, tt.ok, tt.match)
		}
		if ok && tt.match == "exact" && mri[span[0]:span[1]] == "" {
			t.Errorf("%q: empty span", tt.quote)
		}
	}
}

func TestFactsDowngradesUnverified(t *testing.T) {
	docs := map[string]model.Document{"D1": {ID: "D1", Text: mri}}
	fs := &model.FactSheet{Facts: []model.Fact{
		{FactID: "F20", Status: "FOUND", Sources: []model.Source{{DocID: "D1", Quote: "cord compression and T2 cord signal change"}}},
		{FactID: "F11", Status: "FOUND", Sources: []model.Source{{DocID: "D1", Quote: "cannot button shirt"}}},
		{FactID: "F12", Status: "FOUND", Sources: []model.Source{{DocID: "D9", Quote: "x"}}},
	}}
	var st trace.Stage
	dropped := Facts(fs, docs, nil, &st)
	if dropped != 2 {
		t.Fatalf("dropped = %d, want 2", dropped)
	}
	got := map[string]model.Fact{}
	for _, f := range fs.Facts {
		got[f.FactID] = f
	}
	if f := got["F20"]; f.Status != "FOUND" || !f.Sources[0].Verified || f.Sources[0].Quote != "cord compression and T2 cord signal change" {
		t.Errorf("F20 = %+v", f)
	}
	if got["F11"].Status != "MISSING" || got["F12"].Status != "MISSING" {
		t.Errorf("unverified facts not downgraded: %+v %+v", got["F11"], got["F12"])
	}
}

func TestFactsDropsRestatedPolicyMeasurement(t *testing.T) {
	docs := map[string]model.Document{"D1": {ID: "D1", Text: mri}}
	fs := &model.FactSheet{Facts: []model.Fact{
		{FactID: "F20", Category: "Diagnostics", Status: "FOUND", Sources: []model.Source{{DocID: "D1", Quote: "Severe C5-C6 canal stenosis"}}},
		{FactID: "F31", Category: PolicyMeasurement, Status: "FOUND", Sources: []model.Source{{DocID: "D1", Quote: "Severe C5-C6 canal stenosis"}}},
		{FactID: "F32", Category: PolicyMeasurement, Status: "FOUND", Sources: []model.Source{{DocID: "D1", Quote: "moderate foraminal narrowing"}}},
		{FactID: "F33", Category: PolicyMeasurement, Status: "MISSING", Sources: []model.Source{}},
	}}
	st := trace.Begin("validate_facts")
	Facts(fs, docs, nil, &st)
	var ids []string
	for _, f := range fs.Facts {
		ids = append(ids, f.FactID)
	}
	if got := strings.Join(ids, ","); got != "F20,F32,F33" {
		t.Errorf("got %s, want F20,F32,F33", got)
	}
}

func TestRepairAssessment(t *testing.T) {
	facts := map[string]model.Fact{"F1": {FactID: "F1", Status: "FOUND"}, "F2": {FactID: "F2", Status: "MISSING"}, "F29": {FactID: "F29", Aspect: "Missing records", Status: "FOUND"}}
	a := &model.Assessment{Criteria: []model.Criterion{
		{CriterionID: "C1", Status: "MET", Evidence: []model.CriterionEvidence{{FactRef: "F1"}}},
		{CriterionID: "C2", Status: "UNMET", Evidence: []model.CriterionEvidence{{FactRef: "F2"}}},
		{CriterionID: "C3", Status: "MET", Evidence: []model.CriterionEvidence{{FactRef: "F99"}}},
		{CriterionID: "C4", Status: "UNMET", Evidence: []model.CriterionEvidence{{FactRef: "F29"}}},
		{CriterionID: "C5", Status: "UNMET", Evidence: []model.CriterionEvidence{{FactRef: "F29"}, {FactRef: "F1"}}},
		{CriterionID: "C6", Status: "MET", Evidence: []model.CriterionEvidence{{FactRef: "F1"}, {FactRef: "F29"}}},
	}}
	if n := len(AssessmentIssues(a, facts)); n != 5 {
		t.Fatalf("issues = %d, want 5", n)
	}
	var st trace.Stage
	RepairAssessment(a, facts, true, &st)
	want := []string{"MET", "NOT_ASSESSABLE", "NOT_ASSESSABLE", "NOT_ASSESSABLE", "UNMET", "PARTIALLY_MET"}
	for i, c := range a.Criteria {
		if c.Status != want[i] {
			t.Errorf("%s = %s, want %s", c.CriterionID, c.Status, want[i])
		}
	}
}

func TestRequestConflictBlocksUnmet(t *testing.T) {
	facts := map[string]model.Fact{"F1": {FactID: "F1", Status: "FOUND"}}
	a := &model.Assessment{RequestConflict: model.RequestConflict{Present: true, Detail: "form says left, consult says right"}, Criteria: []model.Criterion{
		{CriterionID: "C1", Status: "UNMET", Evidence: []model.CriterionEvidence{{FactRef: "F1"}}},
		{CriterionID: "C2", Status: "MET", Evidence: []model.CriterionEvidence{{FactRef: "F1"}}},
	}}
	var st trace.Stage
	RepairAssessment(a, facts, true, &st)
	if a.Criteria[0].Status != "PARTIALLY_MET" || a.Criteria[1].Status != "MET" {
		t.Errorf("got %s %s, want PARTIALLY_MET MET", a.Criteria[0].Status, a.Criteria[1].Status)
	}
}

func TestAlternativesIssue(t *testing.T) {
	flat := &model.Assessment{Criteria: []model.Criterion{{CriterionID: "C1"}, {CriterionID: "C2"}}}
	grouped := &model.Assessment{Criteria: []model.Criterion{{CriterionID: "C1", AnyOfGroup: "G1"}, {CriterionID: "C2", AnyOfGroup: "G1"}}}
	anyOf := "Covered when ANY of the following is documented: (1) resting SpO2 88% or below; (2) exercise SpO2 88% or below."
	if AlternativesIssue(anyOf, flat) == "" || AlternativesIssue(anyOf, grouped) != "" {
		t.Error("ANY-of policy: flat criteria should be flagged, grouped ones accepted")
	}
	if AlternativesIssue("Covered when ALL of the following are met: (1) BMI 40 or more; (2) program completed.", flat) != "" {
		t.Error("ALL-of policy must not be flagged")
	}
}

func TestUnanchoredCriterionNoPolicy(t *testing.T) {
	a := &model.Assessment{Criteria: []model.Criterion{
		{CriterionID: "C1", Core: true, Status: "NOT_ASSESSABLE"},
		{CriterionID: "C2", Core: true, Status: "NOT_ASSESSABLE", Evidence: []model.CriterionEvidence{{FactRef: "F1"}}},
	}}
	facts := map[string]model.Fact{"F1": {FactID: "F1", Status: "FOUND"}}
	var st trace.Stage
	RepairAssessment(a, facts, false, &st)
	if a.Criteria[0].Core || !a.Criteria[1].Core {
		t.Fatalf("core flags = %v %v, want false true", a.Criteria[0].Core, a.Criteria[1].Core)
	}
	b := &model.Assessment{Criteria: []model.Criterion{{CriterionID: "C1", Core: true, Status: "NOT_ASSESSABLE"}}}
	RepairAssessment(b, facts, true, &st)
	if !b.Criteria[0].Core {
		t.Fatal("with a policy, criteria must keep their core flag")
	}
}
