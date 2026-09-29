# The QC gate of harness-demo (TEST §3). Every change passes `make check` before review.
# A part a later task builds may not be built yet: it prints "not built yet: <path>" and the
# gate goes on. With STRICT=1 it fails instead (harness-demo is STRICT from P2 on; CI runs it).
STRICT ?= 0

PY_TESTS := scripts/tests .claude/hooks/tests scripts/actions/tests
NODE_PARTS := bots/runtime tools/entry-slack-mcp
SECRET_RE := (xox[abpe]-|xap[p]-|lin_(api|oauth)_|nt[n]_|secre[t]_|gh[pous]_|github_pa[t]_|https://hooks[.]slack[.]com/)[^[:space:]]+
SCAN_EXCLUDE := --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=out --exclude-dir=cache \
	--exclude-dir=dist --exclude-dir=.pytest_cache --exclude-dir=__pycache__

.PHONY: check test-py test-forge test-node secret-scan

check: test-py test-forge test-node secret-scan
	@echo "make check: green"

test-py:
	@missing=0; dirs=""; \
	for d in $(PY_TESTS); do \
	  if [ -d "$$d" ]; then dirs="$$dirs $$d"; else echo "not built yet: $$d"; missing=1; fi; \
	done; \
	python3 -m pytest -q $$dirs || exit $$?; \
	if [ "$$missing" = 1 ] && [ "$(STRICT)" = 1 ]; then exit 2; fi

test-forge:
	forge test

test-node:
	@missing=0; \
	for d in $(NODE_PARTS); do \
	  if [ -f "$$d/package.json" ]; then npm --prefix "$$d" run check || exit $$?; \
	  else echo "not built yet: $$d"; missing=1; fi; \
	done; \
	if [ "$$missing" = 1 ] && [ "$(STRICT)" = 1 ]; then exit 2; fi

# Prints file names only, never the matched text (WR BR-12).
secret-scan:
	@files=$$(grep -rlE $(SCAN_EXCLUDE) '$(SECRET_RE)' .); code=$$?; \
	if [ $$code -eq 0 ]; then \
	  for f in $$files; do echo "secret scan: a SEC §3 pattern matches in $$f"; done; exit 1; \
	elif [ $$code -eq 1 ]; then echo "secret scan: nothing found"; \
	else exit $$code; fi
