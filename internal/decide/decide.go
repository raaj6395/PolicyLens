package decide

import (
	"fmt"
	"math"
	"strings"

	"policylens/internal/model"
)

const (
	Approve  = "LIKELY_APPROVE"
	MoreInfo = "NEED_MORE_INFO"
	Deny     = "LIKELY_DENY"

	base           = 0.90
	perConflict    = 0.05
	perNotAssessed = 0.08
	perPartial     = 0.06
	perDropped     = 0.02
	maxDropped     = 0.10
	adminGap       = 0.10
	noPolicy       = 0.30
	noPolicyCap    = 0.45
)

type Input struct {
	Criteria       []model.Criterion `json:"criteria"`
	Contradictions int               `json:"contradictions"`
	DroppedQuotes  int               `json:"dropped_quotes"`
	PolicySupplied bool              `json:"policy_supplied"`
}

var rank = map[string]int{"MET": 3, "PARTIALLY_MET": 2, "NOT_ASSESSABLE": 1, "UNMET": 0}

func collapse(criteria []model.Criterion) []model.Criterion {
	var out []model.Criterion
	at := map[string]int{}
	for _, c := range criteria {
		if c.AnyOfGroup == "" {
			out = append(out, c)
			continue
		}
		i, seen := at[c.AnyOfGroup]
		if !seen {
			at[c.AnyOfGroup] = len(out)
			out = append(out, c)
			continue
		}
		g := &out[i]
		g.CriterionID += "/" + c.CriterionID
		g.Core = g.Core || c.Core
		if rank[c.Status] > rank[g.Status] {
			g.Status, g.Label = c.Status, c.Label
		}
	}
	return out
}

func Decide(in Input) model.Decision {
	in.Criteria = collapse(in.Criteria)
	var coreUnmet, coreGap, adminUnmet, adminGaps, partial, notAssessed []string
	core := 0
	for _, c := range in.Criteria {
		n := name(c)
		if c.Core {
			core++
		}
		switch c.Status {
		case "PARTIALLY_MET":
			partial = append(partial, n)
		case "NOT_ASSESSABLE":
			notAssessed = append(notAssessed, n)
		}
		switch {
		case c.Status == "UNMET" && c.Core:
			coreUnmet = append(coreUnmet, n)
		case c.Status == "UNMET":
			adminUnmet = append(adminUnmet, n)
		case c.Status != "MET" && c.Core:
			coreGap = append(coreGap, n)
		case c.Status != "MET":
			adminGaps = append(adminGaps, n)
		}
	}

	d := model.Decision{}
	switch {
	case len(in.Criteria) == 0:
		d.RuleFired, d.Recommendation, d.NecessityCategory, d.WorkflowState = "no_criteria", MoreInfo, "PLAUSIBLE_INCOMPLETE", "PEND_FOR_CLINICALS"
		d.Explanation = "No criteria could be assessed, so no medical-necessity opinion is possible yet."
		d.BottomLine = "Needs more information: nothing in the packet could be checked against the policy yet."
	case len(coreUnmet) > 0:
		d.RuleFired, d.Recommendation, d.NecessityCategory, d.WorkflowState = "core_unmet", Deny, "NOT_NECESSARY_UNDER_POLICY", "READY_FOR_DECISION"
		d.Explanation = fmt.Sprintf("%s %s documented as not met, so the request is not necessary under the policy. This is a clinical finding, not a paperwork gap.", list(coreUnmet), verb(coreUnmet))
		d.BottomLine = fmt.Sprintf("Likely deny: %d of %d required criteria %s clearly not met (%s).", len(coreUnmet), core, verb(coreUnmet), list(coreUnmet))
		if len(coreGap)+len(adminGaps)+len(adminUnmet) > 0 {
			d.BottomLine += " Missing paperwork would not change this."
		}
	case len(coreGap) > 0 || len(adminUnmet) > 0:
		gaps := append(coreGap, adminUnmet...)
		d.RuleFired, d.Recommendation, d.NecessityCategory, d.WorkflowState = "partial_or_not_assessable", MoreInfo, "PLAUSIBLE_INCOMPLETE", "PEND_FOR_CLINICALS"
		d.Explanation = fmt.Sprintf("No core criterion failed, but %s %s incomplete, so this is a documentation gap and not a denial.", list(gaps), verb(gaps))
		d.BottomLine = fmt.Sprintf("Needs more information: nothing has failed, but %s %s not yet fully documented. Once that arrives, the case can be decided.", list(gaps), verb(gaps))
	case len(adminGaps) > 0:
		d.RuleFired, d.Recommendation, d.NecessityCategory, d.WorkflowState = "core_met_admin_gap", Approve, "SUPPORTED_DOCUMENTED", "READY_FOR_DECISION"
		d.Explanation = fmt.Sprintf("Every core clinical criterion is met; only the non-core packet item %s is incomplete, which does not overturn a complete assessment.", list(adminGaps))
		d.BottomLine = fmt.Sprintf("Likely approve: all %d required %s satisfied with quoted evidence. Only a paperwork item is incomplete (%s).", core, noun(core, "criterion is", "criteria are"), list(adminGaps))
		d.Penalties = append(d.Penalties, model.Penalty{Reason: "approved despite non-core gap " + list(adminGaps), Amount: adminGap})
	default:
		d.RuleFired, d.Recommendation, d.NecessityCategory, d.WorkflowState = "all_met", Approve, "SUPPORTED_DOCUMENTED", "READY_FOR_DECISION"
		d.Explanation = "Every criterion is met with verified evidence."
		d.BottomLine = fmt.Sprintf("Likely approve: all %d %s satisfied with quoted evidence.", len(in.Criteria), noun(len(in.Criteria), "criterion is", "criteria are"))
	}

	if in.Contradictions > 0 {
		d.Penalties = append(d.Penalties, model.Penalty{Reason: fmt.Sprintf("%d contradiction(s) between sources", in.Contradictions), Amount: perConflict * float64(in.Contradictions)})
	}
	if len(notAssessed) > 0 {
		d.Penalties = append(d.Penalties, model.Penalty{Reason: "not assessable: " + list(notAssessed), Amount: perNotAssessed * float64(len(notAssessed))})
	}
	if len(partial) > 0 {
		d.Penalties = append(d.Penalties, model.Penalty{Reason: "partially met: " + list(partial), Amount: perPartial * float64(len(partial))})
	}
	if in.DroppedQuotes > 0 {
		d.Penalties = append(d.Penalties, model.Penalty{Reason: fmt.Sprintf("%d quote(s) not found in source and dropped", in.DroppedQuotes), Amount: math.Min(maxDropped, perDropped*float64(in.DroppedQuotes))})
	}
	if !in.PolicySupplied {
		d.Penalties = append(d.Penalties, model.Penalty{Reason: "no payer policy supplied; judged on learned patterns only (capped LOW)", Amount: noPolicy})
	}

	score := base
	parts := []string{fmt.Sprintf("base %.2f", base)}
	for _, p := range d.Penalties {
		score -= p.Amount
		parts = append(parts, fmt.Sprintf("-%.2f %s", p.Amount, p.Reason))
	}
	if len(in.Criteria) == 0 {
		score = 0.2
	}
	if !in.PolicySupplied {
		score = math.Min(score, noPolicyCap)
	}
	score = math.Round(math.Max(0.05, score)*100) / 100
	d.Confidence = model.Confidence{Level: level(score), Score: score, Rationale: strings.Join(parts, "; ") + fmt.Sprintf(" = %.2f", score)}
	return d
}

func name(c model.Criterion) string {
	if c.Label != "" {
		return c.Label
	}
	return c.CriterionID
}

func noun(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func level(score float64) string {
	switch {
	case score >= 0.75:
		return "HIGH"
	case score >= 0.5:
		return "MEDIUM"
	}
	return "LOW"
}

func list(ids []string) string {
	switch len(ids) {
	case 1:
		return ids[0]
	case 2:
		return ids[0] + " and " + ids[1]
	}
	return strings.Join(ids[:len(ids)-1], ", ") + " and " + ids[len(ids)-1]
}

func verb(ids []string) string {
	if len(ids) == 1 {
		return "is"
	}
	return "are"
}
