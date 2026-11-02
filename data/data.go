package data

import (
	"embed"
	"encoding/json"
	"io/fs"
	"path/filepath"
	"sort"

	"policylens/internal/model"
	"policylens/skill"
)

//go:embed fixtures eval
var files embed.FS

type Expected struct {
	Recommendation string                   `json:"recommendation"`
	Why            string                   `json:"why,omitempty"`
	Criteria       []skill.ExampleCriterion `json:"criteria,omitempty"`
}

type Fixture struct {
	Title    string        `json:"title"`
	Request  model.Request `json:"request"`
	Expected Expected      `json:"expected"`
}

func Fixtures() ([]Fixture, error) {
	paths, _ := fs.Glob(files, "fixtures/*.json")
	sort.Strings(paths)
	var out []Fixture
	for _, p := range paths {
		b, err := files.ReadFile(p)
		if err != nil {
			return nil, err
		}
		var f Fixture
		if err := json.Unmarshal(b, &f); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, nil
}

func EvalReport(mode string) ([]byte, bool) {
	b, err := files.ReadFile("eval/report_" + mode + ".json")
	return b, err == nil
}

func EvalTrace(id string) ([]byte, bool) {
	b, err := files.ReadFile("eval/traces/" + filepath.Base(id) + ".json")
	return b, err == nil
}
