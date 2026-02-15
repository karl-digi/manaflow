.PHONY: fetch-docs clean help

help:
	@echo "Commands:"
	@echo "  make fetch-docs  - Fetch all documentation"
	@echo "  make clean       - Remove fetched docs"

fetch-docs:
	@./fetch-docs.sh

clean:
	@find . -name "llms.txt" -type f -delete
	@find . -type d -empty -delete 2>/dev/null || true
