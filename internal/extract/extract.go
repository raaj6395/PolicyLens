package extract

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"policylens/internal/llm"
	"policylens/internal/model"
	"policylens/internal/trace"
	"policylens/skill"
)

var sections = []string{"Role and hard rules", "Extraction guide", "Source hierarchy"}

func Run(ctx context.Context, p llm.Provider, sk *skill.Skill, docs []model.Document, policy *model.Policy) (fs model.FactSheet, st trace.Stage, err error) {
	st = trace.Begin("extract")
	defer st.End()

	system := sk.System(sections, nil, "", "fact_sheet")
	user := "Build the Patient Fact Sheet for this pre-authorization packet. Copy every quote verbatim from the document it cites.\n\n"
	if policy != nil {
		user += fmt.Sprintf("Payer policy (not a packet document: never quote or cite it; use it only to know which patient measurements and attributes to extract):\n<policy name=%q>\n%s\n</policy>\n\n", policy.Name, policy.Text)
	}
	user += FormatDocs(docs)
	st.Prompt = trace.NewPrompt(system, user, sections, nil)
	chars := 0
	for _, d := range docs {
		chars += len(d.Text)
	}
	st.InputSummary = map[string]int{"documents": len(docs), "characters": chars}

	raws, err := llm.JSON(ctx, p, llm.Request{System: system, User: user, SchemaName: "fact_sheet", Schema: sk.Schemas["fact_sheet"]},
		func(b []byte) error { return sk.Validate("fact_sheet", b) })
	st.RawOutput, st.Retries = raws, max(0, len(raws)-1)
	st.Check("schema", "fact_sheet", err == nil, errText(err))
	if err != nil {
		st.Error = err.Error()
		return fs, st, err
	}
	if err = json.Unmarshal([]byte(raws[len(raws)-1]), &fs); err != nil {
		st.Error = err.Error()
		return fs, st, err
	}
	return fs, st, nil
}

func FormatDocs(docs []model.Document) string {
	var b strings.Builder
	for _, d := range docs {
		fmt.Fprintf(&b, "<document id=%q name=%q type=%q date=%q>\n%s\n</document>\n\n", d.ID, d.Name, d.Type, d.Date, d.Text)
	}
	return b.String()
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
