package model

type Document struct {
	ID   string `json:"doc_id,omitempty"`
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
	Date string `json:"date,omitempty"`
	Text string `json:"text"`
}

type Policy struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

type Options struct {
	Provider        string   `json:"provider,omitempty"`
	ExcludeExamples []string `json:"exclude_examples,omitempty"`
}

type Request struct {
	CaseID    string     `json:"case_id"`
	Documents []Document `json:"documents"`
	Policy    *Policy    `json:"policy,omitempty"`
	Options   Options    `json:"options,omitempty"`
}

type Source struct {
	DocID    string `json:"doc_id"`
	Quote    string `json:"quote"`
	Value    string `json:"value"`
	Date     string `json:"date,omitempty"`
	Verified bool   `json:"verified"`
	Match    string `json:"match,omitempty"`
	Span     []int  `json:"span,omitempty"`
}

type Fact struct {
	FactID   string   `json:"fact_id"`
	Category string   `json:"category"`
	Aspect   string   `json:"aspect"`
	Value    string   `json:"value"`
	Status   string   `json:"status"`
	Sources  []Source `json:"sources"`
	Flags    []string `json:"flags,omitempty"`
}

type FactSheet struct {
	Facts []Fact `json:"facts"`
}

type RequestedService struct {
	Description string   `json:"description"`
	Codes       []string `json:"codes"`
	SiteOfCare  string   `json:"site_of_care"`
}

type Signal struct {
	Group    string   `json:"group"`
	FactRefs []string `json:"fact_refs"`
	Effect   string   `json:"effect"`
	Strength string   `json:"strength"`
	Note     string   `json:"note"`
}

type CriterionEvidence struct {
	FactRef string `json:"fact_ref"`
	Quote   string `json:"quote"`
}

type Criterion struct {
	CriterionID   string              `json:"criterion_id"`
	Label         string              `json:"label"`
	CriterionText string              `json:"criterion_text"`
	Core          bool                `json:"core"`
	AnyOfGroup    string              `json:"any_of_group"`
	Evidence      []CriterionEvidence `json:"evidence"`
	Reasoning     string              `json:"reasoning"`
	Status        string              `json:"status"`
}

type Contradiction struct {
	Issue           string   `json:"issue"`
	FactRefs        []string `json:"fact_refs"`
	PreferredSource string   `json:"preferred_source"`
	Why             string   `json:"why"`
}

type Assessment struct {
	RequestedService  RequestedService `json:"requested_service"`
	ClinicalSummary   string           `json:"clinical_summary"`
	Signals           []Signal         `json:"signals"`
	Criteria          []Criterion      `json:"criteria"`
	Contradictions    []Contradiction  `json:"contradictions"`
	SupportingFactors []string         `json:"supporting_factors"`
	WeakeningFactors  []string         `json:"weakening_factors"`
	RequestConflict   RequestConflict  `json:"request_conflict"`
}

type RequestConflict struct {
	Present bool   `json:"present"`
	Detail  string `json:"detail"`
}

type Penalty struct {
	Reason string  `json:"reason"`
	Amount float64 `json:"amount"`
}

type Confidence struct {
	Level     string  `json:"level"`
	Score     float64 `json:"score"`
	Rationale string  `json:"rationale"`
}

type Decision struct {
	RuleFired         string     `json:"rule_fired"`
	Explanation       string     `json:"explanation"`
	BottomLine        string     `json:"bottom_line"`
	Recommendation    string     `json:"recommendation"`
	NecessityCategory string     `json:"necessity_category"`
	WorkflowState     string     `json:"workflow_state"`
	Confidence        Confidence `json:"confidence"`
	Penalties         []Penalty  `json:"confidence_penalties"`
}

type ProviderQuery struct {
	CriterionID       string `json:"criterion_id"`
	Question          string `json:"question"`
	RequestedDocument string `json:"requested_document"`
}

type MissingInfo struct {
	Item             string `json:"item"`
	AffectsCriterion string `json:"affects_criterion"`
	WhyItMatters     string `json:"why_it_matters"`
}

type Queries struct {
	ProviderQueries    []ProviderQuery `json:"provider_queries"`
	MissingInformation []MissingInfo   `json:"missing_information"`
	AppealDirection    string          `json:"appeal_direction"`
}

type Evidence struct {
	FactID    string `json:"fact_id"`
	SourceDoc string `json:"source_doc"`
	DocID     string `json:"doc_id"`
	Snippet   string `json:"snippet"`
	Span      []int  `json:"span,omitempty"`
}

type CriterionResult struct {
	CriterionID   string     `json:"criterion_id"`
	Label         string     `json:"label,omitempty"`
	CriterionText string     `json:"criterion_text"`
	Core          bool       `json:"core"`
	AnyOfGroup    string     `json:"any_of_group,omitempty"`
	Status        string     `json:"status"`
	Reasoning     string     `json:"reasoning"`
	Evidence      []Evidence `json:"evidence"`
}

type ContradictionResult struct {
	Issue           string     `json:"issue"`
	Sources         []string   `json:"sources"`
	PreferredSource string     `json:"preferred_source"`
	Why             string     `json:"why"`
	Evidence        []Evidence `json:"evidence"`
}

type Result struct {
	TraceID            string                `json:"trace_id"`
	SkillVersion       string                `json:"skill_version"`
	Provider           string                `json:"provider"`
	Model              string                `json:"model"`
	CaseID             string                `json:"case_id"`
	RequestedService   RequestedService      `json:"requested_service"`
	BottomLine         string                `json:"bottom_line"`
	ClinicalSummary    string                `json:"clinical_summary"`
	CriteriaAssessment []CriterionResult     `json:"criteria_assessment"`
	CriteriaMet        []string              `json:"criteria_met"`
	CriteriaNotMet     []string              `json:"criteria_partial_or_unmet"`
	SupportingFactors  []string              `json:"supporting_factors"`
	WeakeningFactors   []string              `json:"weakening_factors"`
	Contradictions     []ContradictionResult `json:"contradictions"`
	MissingInformation []MissingInfo         `json:"missing_information"`
	NecessityCategory  string                `json:"necessity_category"`
	Recommendation     string                `json:"recommendation"`
	WorkflowState      string                `json:"workflow_state"`
	Confidence         Confidence            `json:"confidence"`
	ProviderQueries    []ProviderQuery       `json:"provider_queries"`
	AppealDirection    string                `json:"appeal_direction"`
	PolicyUsed         string                `json:"policy_used"`
}
