package llm

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotEnv(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".env")
	os.WriteFile(p, []byte("# comment\nDOTENV_A=one\nexport DOTENV_B=\"two\"\nDOTENV_C=\nDOTENV_D=fromfile\n"), 0o600)
	t.Setenv("DOTENV_D", "fromshell")
	if err := LoadDotEnv(p); err != nil {
		t.Fatal(err)
	}
	for k, want := range map[string]string{"DOTENV_A": "one", "DOTENV_B": "two", "DOTENV_C": "", "DOTENV_D": "fromshell"} {
		if got := os.Getenv(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	if err := LoadDotEnv(filepath.Join(t.TempDir(), "missing")); err != nil {
		t.Fatal(err)
	}
}
