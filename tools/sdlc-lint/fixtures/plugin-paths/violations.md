# fixture: home-anchored paths
manifests = Glob("~/.claude/plugins/cache/**/manifest.yaml")
stamp = read("~/.claude/.sdlc-deps-preflight.json")
registry = join($HOME/.claude/plugins/cache, "models.json")
nested = "${HOME}/.claude/projects/<cwd>/<session>.jsonl"
