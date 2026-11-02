package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"policylens/data"
	"policylens/internal/model"
	"policylens/skill"
)

func parseTable(path string) []map[string]string {
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatal(err)
	}
	var header []string
	var rows []map[string]string
	for line := range strings.SplitSeq(string(b), "\n") {
		if !strings.HasPrefix(line, "|") {
			continue
		}
		cells := strings.Split(strings.Trim(strings.TrimSpace(line), "|"), "|")
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		switch {
		case header == nil:
			header = cells
		case strings.HasPrefix(cells[0], "---"):
		default:
			row := map[string]string{}
			for i, h := range header {
				if i < len(cells) {
					row[h] = cells[i]
				}
			}
			rows = append(rows, row)
		}
	}
	return rows
}

func write(path string, v any) {
	b, _ := json.MarshalIndent(v, "", "  ")
	if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Println("wrote", path)
}

func trainingDocs(r map[string]string) []model.Document {
	return []model.Document{
		{Name: "Pre-auth request form", Type: "request_form", Text: "Requested service: " + r["Requested_Service"] + "."},
		{Name: "Clinical summary", Type: "clinical_note", Text: "Clinical scenario: " + r["Clinical_Scenario"] + ".\nKey findings: " + r["Key_Supporting_Evidence"] + "."},
		{Name: "Utilization review note", Type: "utilization_review", Text: "Gaps or risks noted: " + r["Key_Gaps_or_Risks"] + "."},
	}
}

func main() {
	wb := "data/workbook"
	for _, r := range parseTable(filepath.Join(wb, "02_Training_Cases.md")) {
		id := r["Case_ID"]
		docs := trainingDocs(r)
		var packet []string
		for _, d := range docs {
			packet = append(packet, d.Name+": "+d.Text)
		}
		write(filepath.Join("skill/examples", id+".json"), skill.Example{
			CaseID:         id,
			Service:        r["Requested_Service"],
			Packet:         strings.Join(packet, "\n"),
			Recommendation: r["Expected_Outcome"],
			Why:            r["Why"],
			IfMoreDocs:     r["If Additional Documentation Arrives"],
		})
		write(filepath.Join("data/fixtures", id+".json"), data.Fixture{
			Title:    id + " · " + r["Requested_Service"],
			Request:  model.Request{CaseID: id, Documents: docs},
			Expected: data.Expected{Recommendation: r["Expected_Outcome"]},
		})
	}

}
