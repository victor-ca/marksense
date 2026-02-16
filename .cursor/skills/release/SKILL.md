---
name: release
description: Prepare and publish a new release of the Marksense extension. Suggests a version number, updates CHANGELOG.md and package.json/package-lock.json, commits, and creates a GitHub release. Use when the user wants to release, publish, bump version, or create a new version.
---

# Release Workflow

Automates the full release cycle for the Marksense VS Code extension.

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- Working directory is clean (no uncommitted changes unrelated to the release)
- On the `main` branch

## Workflow

### Step 1: Gather changes since last release

Run these commands to understand what changed:

```bash
# Get the latest release tag
git describe --tags --abbrev=0

# List commits since that tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

Read the output carefully. Categorize each commit as one of:
- **Added** — new features or capabilities
- **Improved** — enhancements to existing features
- **Fixed** — bug fixes
- **Changed** — breaking or behavioral changes
- **Removed** — removed features

### Step 2: Suggest a version number

Read the current version from `package.json`.

Apply semver rules to suggest the next version:
- **Patch** (x.y.Z) — bug fixes only, no new features
- **Minor** (x.Y.0) — new features, improvements, no breaking changes
- **Major** (X.0.0) — breaking changes

Present the suggestion to the user using AskQuestion with these options:
- The suggested version (pre-selected based on changes)
- The other two semver bumps
- "Custom version" if none fit

Example: if current is `1.0.2` and changes are improvements + fixes, suggest `1.1.0` (minor) but also offer `1.0.3` (patch) and `2.0.0` (major).

**Wait for user confirmation before proceeding.**

### Step 3: Update version in package files

Use `npm version` which atomically updates both `package.json` and `package-lock.json`:

```bash
npm version <confirmed-version> --no-git-tag-version
```

The `--no-git-tag-version` flag is important — the release script handles tagging.

### Step 4: Update CHANGELOG.md

Read the current `CHANGELOG.md`. Insert a new section **at the top**, right after the `# Changelog` heading, following this exact format:

```
## <version> — <YYYY-MM-DD>

### Added
- Item (only if there are items in this category)

### Improved
- Item (only if there are items in this category)

### Fixed
- Item (only if there are items in this category)

### Changed
- Item (only if there are items in this category)

### Removed
- Item (only if there are items in this category)
```

Rules:
- Only include category headings that have items
- Use present tense, start with a verb (e.g. "Add", "Fix", "Update")
- Keep entries concise but descriptive — one line each
- Write entries from the user's perspective, not the developer's
- Match the tone and style of existing entries in the file
- Today's date is available from the system; use it for the date

### Step 5: Commit the version bump

Stage and commit only the version/changelog files:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: bump version to <version>"
git push origin main
```

### Step 6: Create the release

Run the release script which builds, packages, tags, and creates the GitHub release:

```bash
npm run release
```

This script (`scripts/release.sh`) will:
1. Read the version from `package.json`
2. Extract release notes from `CHANGELOG.md`
3. Build the extension and package the `.vsix`
4. Create and push a git tag `v<version>`
5. Create a GitHub release with the changelog as body and `.vsix` attached

Monitor the output and report the release URL back to the user when done.

## Error Handling

- If the working directory is dirty, warn the user and ask if they want to proceed
- If `npm run release` fails, check the error output and report it — do not retry automatically
- If `gh` is not authenticated, instruct the user to run `gh auth login`
