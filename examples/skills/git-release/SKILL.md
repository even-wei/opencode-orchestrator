---
name: git-release
description: Automates semantic git versioning, changelog generation, and GitHub release creation
---

# Git Release Automation Skill

This skill guides the agent through preparing and publishing semantic version releases for the project.

## Workflow

1. **Inspect Git Status & Tags:**
   - Run `git status` to ensure working directory is clean.
   - Run `git tag --sort=-v:refname | head -n 5` to inspect recent release versions.

2. **Analyze Commits Since Last Tag:**
   - Run `git log $(git describe --tags --abbrev=0)..HEAD --oneline` to review changes.
   - Categorize commits into `Features`, `Bug Fixes`, and `Maintenance`.

3. **Bump Semantic Version:**
   - Update `package.json` version accordingly (`patch`, `minor`, `major`).
   - Create annotated tag: `git tag -a v<version> -m "Release v<version>"`.

4. **Verify Tests Before Publishing:**
   - Execute `npm test` and `npm run build`.
