package validate

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"policylens/internal/model"
	"policylens/internal/trace"
	"policylens/skill"
)

const fuzzyThreshold = 0.9

type token struct {
	text       string
	start, end int
}

func tokenize(s string) []token {
	var out []token
	start := -1
	for i, r := range s {
		word := unicode.IsLetter(r) || unicode.IsDigit(r)
		switch {
		case word && start < 0:
			start = i
		case !word && start >= 0:
			out = append(out, token{strings.ToLower(s[start:i]), start, i})
			start = -1
		}
	}
	if start >= 0 {
		out = append(out, token{strings.ToLower(s[start:]), start, len(s)})
	}
	return out
}

func FindQuote(doc, quote string) (span []int, match string, ok bool) {
	d, q := tokenize(doc), tokenize(quote)
	n := len(q)
	if n == 0 || len(d) < n {
		return nil, "", false
	}
	best, bestAt := 0.0, -1
	for i := 0; i+n <= len(d); i++ {
		exact := true
		need := map[string]int{}
		for _, t := range q {
			need[t.text]++
		}
		hits := 0
		for j := range n {
			if d[i+j].text != q[j].text {
				exact = false
			}
			if need[d[i+j].text] > 0 {
				need[d[i+j].text]--
				hits++
			}
		}
		if exact {
			return []int{d[i].start, d[i+n-1].end}, "exact", true
		}
		if score := float64(hits) / float64(n); score > best {
			best, bestAt = score, i
		}
	}
	if best >= fuzzyThreshold {
		return []int{d[bestAt].start, d[bestAt+n-1].end}, "fuzzy", true
	}
	return nil, "", false
}

func Facts(fs *model.FactSheet, docs map[string]model.Document, aspects []skill.Aspect, st *trace.Stage) (dropped int) {
	seen := map[string]bool{}
	var facts []model.Fact
	for _, f := range fs.Facts {
		if seen[f.FactID] {
			st.Check("unique_fact_id", f.FactID, false, "duplicate fact dropped")
			continue
		}
		seen[f.FactID] = true
		var kept []model.Source
		for _, s := range f.Sources {
			target := f.FactID + "/" + s.DocID
			doc, ok := docs[s.DocID]
			if !ok {
				st.Check("doc_exists", target, false, "unknown document")
				f.Flags = append(f.Flags, "dropped source citing unknown document "+s.DocID)
				dropped++
				continue
			}
			span, match, ok := FindQuote(doc.Text, s.Quote)
			st.Check("quote_in_source", target, ok, quoteDetail(s.Quote, match))
			if !ok {
				f.Flags = append(f.Flags, fmt.Sprintf("dropped unverified quote from %s: %q", s.DocID, s.Quote))
				dropped++
				continue
			}
			s.Verified, s.Match, s.Span = true, match, span
			s.Quote = doc.Text[span[0]:span[1]]
			kept = append(kept, s)
		}
		f.Sources = kept
		if f.Status != "MISSING" && len(kept) == 0 {
			st.Check("found_has_quote", f.FactID, false, "no verified quote, downgraded to MISSING")
			f.Flags = append(f.Flags, "downgraded "+f.Status+" to MISSING: no verified quote")
			f.Status, f.Value = "MISSING", ""
		}
		if f.Status == "MISSING" && len(kept) > 0 {
			f.Status = "FOUND"
		}
		facts = append(facts, f)
	}
	held := map[string]bool{}
	for _, f := range facts {
		if f.Category != PolicyMeasurement {
			for _, s := range f.Sources {
				held[fmt.Sprint(s.DocID, s.Span)] = true
			}
		}
	}
	kept := facts[:0]
	for _, f := range facts {
		if f.Category == PolicyMeasurement && len(f.Sources) > 0 && allHeld(f.Sources, held) {
			st.Check("policy_measurement_adds_evidence", f.FactID, false, "quotes already held by other facts, dropped as a restatement")
			continue
		}
		kept = append(kept, f)
	}
	facts = kept
	for _, a := range aspects {
		id := fmt.Sprintf("F%d", a.Num)
		if !seen[id] {
			st.Check("aspect_present", id, false, "aspect not returned, added as MISSING")
			facts = append(facts, model.Fact{FactID: id, Category: a.Category, Aspect: a.Aspect, Status: "MISSING", Sources: []model.Source{}})
		}
	}
	fs.Facts = facts
	return dropped
}

const PolicyMeasurement = "Policy measurement"

func allHeld(sources []model.Source, held map[string]bool) bool {
	for _, s := range sources {
		if !held[fmt.Sprint(s.DocID, s.Span)] {
			return false
		}
	}
	return true
}

func quoteDetail(q, match string) string {
	if match == "" {
		return "not found in source: " + q
	}
	return match + " match"
}

func usable(facts map[string]model.Fact, ref string) bool {
	f, ok := facts[ref]
	return ok && f.Status != "MISSING"
}

func citesMissingRecords(c model.Criterion, facts map[string]model.Fact) bool {
	for _, e := range c.Evidence {
		if usable(facts, e.FactRef) && facts[e.FactRef].Aspect == "Missing records" {
			return true
		}
	}
	return false
}

func onlyMissingRecords(c model.Criterion, facts map[string]model.Fact) bool {
	any := false
	for _, e := range c.Evidence {
		if !usable(facts, e.FactRef) {
			continue
		}
		if facts[e.FactRef].Aspect != "Missing records" {
			return false
		}
		any = true
	}
	return any
}

var alternatives = regexp.MustCompile(`(?i)\bany (one )?of the following\b|\bat least one of\b|\beither\b[^.;]{0,300}\bor\b`)

func AlternativesIssue(policy string, a *model.Assessment) string {
	if !alternatives.MatchString(policy) {
		return ""
	}
	for _, c := range a.Criteria {
		if c.AnyOfGroup != "" {
			return ""
		}
	}
	return "the policy lists alternatives (\"any of the following\" or \"either ... or\") but no criterion has an any_of_group; give each alternative its own criterion with the same any_of_group label"
}

func AssessmentIssues(a *model.Assessment, facts map[string]model.Fact) []string {
	var issues []string
	ids := map[string]bool{}
	for _, c := range a.Criteria {
		if ids[c.CriterionID] {
			issues = append(issues, "duplicate criterion_id "+c.CriterionID)
		}
		ids[c.CriterionID] = true
		hasUsable := false
		for _, e := range c.Evidence {
			if _, ok := facts[e.FactRef]; !ok {
				issues = append(issues, fmt.Sprintf("%s cites unknown fact %s", c.CriterionID, e.FactRef))
			}
			hasUsable = hasUsable || usable(facts, e.FactRef)
		}
		if (c.Status == "MET" || c.Status == "UNMET") && !hasUsable {
			issues = append(issues, fmt.Sprintf("%s is %s but cites no FOUND or CONFLICT fact; cite evidence or use NOT_ASSESSABLE", c.CriterionID, c.Status))
		}
		if c.Status == "MET" && citesMissingRecords(c, facts) {
			issues = append(issues, fmt.Sprintf("%s is MET but cites a packet-reported documentation gap; use PARTIALLY_MET", c.CriterionID))
		}
		if c.Status == "UNMET" && onlyMissingRecords(c, facts) {
			issues = append(issues, fmt.Sprintf("%s is UNMET but its only evidence is a Missing records fact; a documentation gap is PARTIALLY_MET or NOT_ASSESSABLE, never UNMET", c.CriterionID))
		}
	}
	if len(a.Criteria) == 0 {
		issues = append(issues, "criteria is empty")
	}
	for i, s := range a.Signals {
		for _, r := range s.FactRefs {
			if _, ok := facts[r]; !ok {
				issues = append(issues, fmt.Sprintf("signals[%d] cites unknown fact %s", i, r))
			}
		}
	}
	for i, c := range a.Contradictions {
		for _, r := range c.FactRefs {
			if _, ok := facts[r]; !ok {
				issues = append(issues, fmt.Sprintf("contradictions[%d] cites unknown fact %s", i, r))
			}
		}
	}
	return issues
}

func RepairAssessment(a *model.Assessment, facts map[string]model.Fact, policySupplied bool, st *trace.Stage) {
	for i := range a.Criteria {
		c := &a.Criteria[i]
		if a.RequestConflict.Present && c.Status == "UNMET" {
			st.Check("request_identity_clear", c.CriterionID, false, "documents disagree about what is requested, so UNMET becomes PARTIALLY_MET: "+a.RequestConflict.Detail)
			c.Status = "PARTIALLY_MET"
			c.Reasoning += " [Not judged as unmet: the documents disagree about what is being requested (" + a.RequestConflict.Detail + "); the provider must clarify first.]"
		}
		if !policySupplied && c.Core && c.Status == "NOT_ASSESSABLE" && len(c.Evidence) == 0 {
			st.Check("unanchored_criterion", c.CriterionID, false, "no policy and nothing in the packet speaks to it: treated as non-core")
			c.Core = false
			c.Reasoning += " [Treated as non-core: no policy states it and the packet says nothing about it.]"
		}
		var kept []model.CriterionEvidence
		for _, e := range c.Evidence {
			if _, ok := facts[e.FactRef]; ok {
				kept = append(kept, e)
			} else {
				st.Check("fact_ref_exists", c.CriterionID+"/"+e.FactRef, false, "unknown fact reference dropped")
			}
		}
		c.Evidence = kept
		hasUsable := false
		for _, e := range kept {
			hasUsable = hasUsable || usable(facts, e.FactRef)
		}
		if c.Status == "MET" || c.Status == "UNMET" {
			st.Check("evidence_before_status", c.CriterionID, hasUsable, c.Status+" requires a FOUND or CONFLICT fact")
			if !hasUsable {
				c.Reasoning += " [Downgraded from " + c.Status + ": no verified evidence.]"
				c.Status = "NOT_ASSESSABLE"
			}
		}
		if c.Status == "MET" {
			gap := citesMissingRecords(*c, facts)
			st.Check("met_without_reported_gap", c.CriterionID, !gap, "MET cannot cite a packet-reported documentation gap")
			if gap {
				c.Reasoning += " [Downgraded from MET: the packet reports a documentation gap for this criterion.]"
				c.Status = "PARTIALLY_MET"
			}
		}
		if c.Status == "UNMET" {
			gap := onlyMissingRecords(*c, facts)
			st.Check("unmet_is_clinical", c.CriterionID, !gap, "UNMET must rest on a clinical fact, not only on a missing-records note")
			if gap {
				c.Reasoning += " [Downgraded from UNMET: the only evidence is that documentation is missing, which is a paperwork gap.]"
				c.Status = "NOT_ASSESSABLE"
			}
		}
	}
	a.Signals = filterRefs(a.Signals, facts, func(s *model.Signal) *[]string { return &s.FactRefs })
	a.Contradictions = filterRefs(a.Contradictions, facts, func(c *model.Contradiction) *[]string { return &c.FactRefs })
}

func filterRefs[T any](items []T, facts map[string]model.Fact, refs func(*T) *[]string) []T {
	for i := range items {
		r := refs(&items[i])
		var kept []string
		for _, id := range *r {
			if _, ok := facts[id]; ok {
				kept = append(kept, id)
			}
		}
		*r = kept
	}
	return items
}
