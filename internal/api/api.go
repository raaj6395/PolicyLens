package api

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"policylens/data"
	"policylens/internal/model"
	"policylens/internal/pipeline"
)

const maxBody = 6 << 20

type Server struct {
	Pipeline *pipeline.Pipeline
	Fixtures []data.Fixture
	APIKey   string
	Limit    *Limiter
	Web      fs.FS

	mu       sync.Mutex
	feedback []Feedback
}

type Feedback struct {
	TraceID      string    `json:"trace_id"`
	CorrectLabel string    `json:"correct_label"`
	Reason       string    `json:"reason"`
	At           time.Time `json:"at"`
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("POST /v1/assess", s.guard(s.assess))
	mux.HandleFunc("POST /v1/cases/{id}/run", s.guard(s.runCase))
	mux.HandleFunc("POST /v1/feedback", s.guard(s.postFeedback))
	mux.HandleFunc("GET /v1/traces", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.Pipeline.Store.List()) })
	mux.HandleFunc("GET /v1/traces/{id}", s.getTrace)
	mux.HandleFunc("GET /v1/cases", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.Fixtures) })
	mux.HandleFunc("GET /v1/skill", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.Pipeline.Skill) })
	mux.HandleFunc("GET /v1/eval", func(w http.ResponseWriter, r *http.Request) {
		mode := r.URL.Query().Get("mode")
		if mode == "" {
			mode = "loo"
		}
		b, ok := data.EvalReport(mode)
		if !ok {
			writeErr(w, 404, "not_found", "no eval report bundled; run go run ./cmd/eval", nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	})
	if s.Web != nil {
		mux.Handle("GET /", spa(s.Web))
	}
	return mux
}

func (s *Server) guard(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.APIKey != "" && r.Header.Get("X-API-Key") != s.APIKey {
			writeErr(w, 401, "unauthorized", "missing or invalid X-API-Key", nil)
			return
		}
		if s.Limit != nil && !s.Limit.Allow(clientIP(r)) {
			writeErr(w, 429, "rate_limited", "too many requests; free LLM quotas are small, try again in a minute", nil)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		h(w, r)
	}
}

func (s *Server) assess(w http.ResponseWriter, r *http.Request) {
	var req model.Request
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeErr(w, 400, "bad_json", err.Error(), nil)
		return
	}
	s.execute(w, r, req)
}

func (s *Server) runCase(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	for _, f := range s.Fixtures {
		if f.Request.CaseID == id {
			req := f.Request
			req.Documents = append([]model.Document(nil), f.Request.Documents...)
			if p := r.URL.Query().Get("provider"); p != "" {
				req.Options.Provider = p
			}
			s.execute(w, r, req)
			return
		}
	}
	writeErr(w, 404, "not_found", "unknown case "+id, nil)
}

func (s *Server) execute(w http.ResponseWriter, r *http.Request, req model.Request) {
	t, prov, err := s.Pipeline.Start(req)
	if err != nil {
		code := 500
		if errors.Is(err, pipeline.ErrInvalid) {
			code = 400
		}
		writeErr(w, code, "invalid_request", err.Error(), nil)
		return
	}
	if r.URL.Query().Get("async") == "true" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
			defer cancel()
			s.Pipeline.Run(ctx, t, prov)
		}()
		writeJSON(w, 202, map[string]string{"trace_id": t.TraceID, "status": "running", "trace_url": "/v1/traces/" + t.TraceID})
		return
	}
	if err := s.Pipeline.Run(r.Context(), t, prov); err != nil {
		writeErr(w, 502, "pipeline_failed", err.Error(), map[string]string{"trace_id": t.TraceID})
		return
	}
	if r.URL.Query().Get("include_trace") == "true" {
		writeJSON(w, 200, map[string]any{"result": t.Result, "trace": t})
		return
	}
	writeJSON(w, 200, t.Result)
}

func (s *Server) getTrace(w http.ResponseWriter, r *http.Request) {
	b, ok := s.Pipeline.Store.Get(r.PathValue("id"))
	if !ok {
		b, ok = data.EvalTrace(r.PathValue("id"))
	}
	if !ok {
		writeErr(w, 404, "not_found", "trace not found or expired", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(b)
}

func (s *Server) postFeedback(w http.ResponseWriter, r *http.Request) {
	var f Feedback
	if err := json.NewDecoder(r.Body).Decode(&f); err != nil || f.TraceID == "" || f.CorrectLabel == "" {
		writeErr(w, 400, "bad_request", "trace_id and correct_label are required", nil)
		return
	}
	f.At = time.Now()
	s.mu.Lock()
	s.feedback = append(s.feedback, f)
	n := len(s.feedback)
	s.mu.Unlock()
	slog.Info("feedback", "trace_id", f.TraceID, "correct_label", f.CorrectLabel)
	writeJSON(w, 201, map[string]any{"stored": true, "total": n})
}

func spa(web fs.FS) http.Handler {
	files := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(web, strings.TrimPrefix(r.URL.Path, "/")); err != nil {
			r.URL.Path = "/"
		}
		files.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type Limiter struct {
	mu     sync.Mutex
	perMin int
	window time.Time
	counts map[string]int
}

func NewLimiter(perMin int) *Limiter {
	return &Limiter{perMin: perMin, counts: map[string]int{}}
}

func (l *Limiter) Allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now := time.Now().Truncate(time.Minute); now.After(l.window) {
		l.window, l.counts = now, map[string]int{}
	}
	l.counts[ip]++
	return l.counts[ip] <= l.perMin
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(v)
}

func writeErr(w http.ResponseWriter, code int, kind, msg string, details any) {
	writeJSON(w, code, map[string]any{"error": msg, "code": kind, "details": details})
}
