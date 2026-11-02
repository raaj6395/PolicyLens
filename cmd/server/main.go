package main

import (
	"log"
	"log/slog"
	"net/http"
	"os"
	"strconv"

	"policylens/data"
	"policylens/internal/api"
	"policylens/internal/llm"
	"policylens/internal/pipeline"
	"policylens/internal/trace"
	"policylens/skill"
	"policylens/web"
)

func main() {
	//load env
	if err := llm.LoadDotEnv(".env"); err != nil {
		log.Fatal(err)
	}

	// load skill
	sk, err := skill.Load()
	if err != nil {
		log.Fatal(err)
	}
	//load prev all 10 cases
	fixtures, err := data.Fixtures()
	if err != nil {
		log.Fatal(err)
	}
	//rate limitter un-necssary
	perMin, _ := strconv.Atoi(os.Getenv("RATE_LIMIT_PER_MIN"))
	if perMin <= 0 {
		perMin = 10
	}

	dir := os.Getenv("TRACE_DIR")
	if dir == "" {
		dir = "runs"
	}
	store, err := trace.NewDisk(dir)
	if err != nil {
		log.Fatal(err)
	}

	s := &api.Server{
		Pipeline: &pipeline.Pipeline{Skill: sk, Store: store, NewProvider: llm.New},
		Fixtures: fixtures,
		APIKey:   os.Getenv("API_KEY"),
		Limit:    api.NewLimiter(perMin),
		Web:      web.FS(),
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	slog.Info("listening", "port", port, "skill_version", sk.Version, "default_provider", llm.DefaultProvider(), "auth", s.APIKey != "")
	log.Fatal(http.ListenAndServe(":"+port, s.Routes()))
}
