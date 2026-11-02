.PHONY: web build run test seed eval eval-insample docker

web:
	cd web && npm ci && npm run build

build: web
	go build -o bin/server ./cmd/server

run: build
	./bin/server

test:
	go test ./...

seed:
	go run ./cmd/seed

eval:
	go run ./cmd/eval -mode loo

eval-insample:
	go run ./cmd/eval -mode insample

docker:
	docker build -t policylens .
