.PHONY: install dev worker test

install:
	pip install -r requirements-dev.txt

dev:
	docker compose up --build

worker:
	celery -A worker.celery_app worker --loglevel=info

test:
	pytest -v
