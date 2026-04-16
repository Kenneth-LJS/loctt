# Claude Code Setup Guide

This guide documents how to set up Claude Code with skills-based workflows and housekeeping rules for new projects.

## Overview

This setup creates a consistent development workflow with:
- **Skills (slash commands)** for common workflows (`/review`, `/cleanup`, etc.)
- **Housekeeping rules** enforced across all interactions
- **Built-in capabilities** leveraged instead of custom agents
- **Project context** via CLAUDE.md

## Prerequisites

- Claude Code installed and running
- Project initialized with basic structure

## Quick Setup for New Developers

### 1. MCP Server Configuration (If Needed)

MCP servers provide Claude Code with access to external tools (Figma, Jira, etc.).

```bash
# Copy the template (if your project has one)
cp .mcp.example.json .mcp.json

# Edit .mcp.json with your credentials
```

### 2. Environment-Specific Configuration

If your project uses `.claude/agent-env.md` for machine/person-specific values (paths, emails, etc.), copy the template and fill in your values:

```bash
cp .claude/agent-env.example.md .claude/agent-env.md
# Edit with your values
```

---

## Initial Project Decisions

Before starting setup, establish key architectural requirements that affect implementation from day one.

### Internationalization (i18n) / Translations

**CRITICAL**: Decide on translation requirements early - retrofitting i18n is significantly more work than building with it from the start.

**Options:**

1. **Translations needed from the beginning** - Set up i18n library from the start, all text goes through translation functions
2. **Translations needed in the future** - Write i18n-friendly code (no hardcoded strings in logic, use constants), but don't install i18n library yet
3. **Translations never needed** - Hardcoded strings are fine, simpler codebase

**Document your decision in `CLAUDE.md`** with guidelines for how text/strings should be handled.

## Core Development Principles

### Thoughtful Implementation Process

**CRITICAL**: Include this in every project's `CLAUDE.md`.

When adding features, enhancements, or bug fixes:

1. **Understand Intent** - Ask clarifying questions if purpose isn't obvious
2. **Investigate Impact** - How does this affect existing features? Breaking changes?
3. **Identify Complications** - Edge cases, dependencies, testing needs
4. **THEN Implement** - Only after understanding, investigating, and identifying issues

**Anti-Pattern**: Jumping straight to code/documentation changes without analysis.
**Correct Pattern**: Question -> Analyze -> Discuss -> Implement

### No Quick Fixes or Shortcuts

When encountering problems, always solve the root cause, never apply symptomatic fixes.

**Prohibited shortcuts**:
- Suppressing error logs instead of fixing the error source
- Adding workarounds instead of addressing the underlying issue
- Hiding warnings instead of resolving what causes them

**Correct approach**: Identify root cause -> Understand why -> Fix source -> Verify

**If you want to suggest an alternative solution**: Bring it to the user and discuss it first.

### Documentation Integrity

When working on PRDs, architecture docs, or any documentation, only include information explicitly stated by the user.

- If sections are incomplete, mark them as **[PLACEHOLDER - To be discussed]**
- Ask clarifying questions before adding any content
- Never invent specifications, requirements, or technical details

### Version Control for Claude Configuration

**Default: Track all Claude files** unless you have specific reasons not to.

Development happens across multiple computers - Claude configuration is part of project infrastructure.

## Setup Steps

### Step 1: Initialize Project Context

Use the built-in `/init` skill to create `CLAUDE.md`:

```
/init
```

This creates a project memory file that Claude Code reads automatically.

**What to include in CLAUDE.md:**
- Build/test/run commands specific to your project
- Architecture patterns (not file-by-file listings)
- Technology stack and dependencies
- Key design decisions
- Development workflow principles (see Core Development Principles above)

**What NOT to include:**
- Obvious instructions or generic best practices
- Detailed file structure (Claude can discover this)
- Repetitive information

### Step 2: Create .claude Directory Structure

```bash
mkdir -p .claude/skills
# Optional: create PRD folders if using PRD-driven workflow
# mkdir -p prds/{01-planning,02-backlog,03-implementing,04-done,05-not-doing}
```

Directory structure:
```
.claude/
├── housekeeping.md       # Shared rules for all interactions
├── git-flow-config.md    # Git workflow configuration
└── skills/               # Custom slash commands (skills)
    ├── review/SKILL.md
    ├── cleanup/SKILL.md
    └── ...
```

### Step 3: Create Housekeeping Rules

Create `.claude/housekeeping.md` with your project's standards and cleanup rules.

**Core sections to include:**

#### Cleanup Checklist (Before Finishing Features)
- Remove test/migration scripts
- Remove debug logging statements
- Delete implementation/migration documentation
- Remove outdated documentation and functionality
- Strip version indicators from naming (v2, new_, phase2, etc.)

#### Update Checklist (Before Finishing Features)
- Update all relevant documentation
- Update quick start guides (if applicable)

#### Documentation Standards
- Keep documentation current with code
- Max 5-8 files per documentation folder
- Separate implementation docs (temporary) from user docs (permanent)
- No version indicators (NEW, PHASE 2, etc.)

#### Folder Structure Rules
- Keep root directory clean (minimal files)
- Documentation: Max 10-15 files/folders per level
- Code: Flexible based on homogeneity (OK to exceed for same-type files)

#### Code Comment Standards
- High-level descriptions only (intention, not implementation)
- Describe WHY, not WHAT
- No redundant line-by-line comments

### Step 4: Configure Git Workflow

Create `.claude/git-flow-config.md` to specify how commits and branches are handled.

#### Available Git Flow Modes

| Mode | Description | Best For |
|------|-------------|----------|
| `no-commits` | Changes made without committing; user commits manually | Small projects, learning |
| `auto-commit` | Commits after each completed subtask | Solo development |
| `feature-branch` | Feature branches with PRs for review | Team projects |
| `custom` | User-defined workflow | Special requirements |

In all modes, do not credit Claude/AI agents by default unless the user requests otherwise.

#### Git Flow Template

Create `.claude/git-flow-config.md`:

```markdown
# Git Flow Configuration

## Current Project Configuration

**Git Flow Mode**: `[no-commits|auto-commit|feature-branch|custom]`

**Description**: [How this mode works for your project]

## Configuration History

| Date | Mode | Reason |
|------|------|--------|
| YYYY-MM-DD | [mode] | [Why chosen] |
```

### Step 5: Create Skills (Slash Commands)

Skills replace the old agents + commands approach. Claude Code has built-in capabilities for code review (`/review`), security review (`/security-review`), PR review (`/review-pr`), and project initialization (`/init`).

Create custom skill files in `.claude/skills/<name>/SKILL.md` for project-specific workflows.

#### Skill File Format

```markdown
---
name: skill-name
description: Brief description of what this skill does
user-invocable: true
---

[Detailed instructions for Claude when this skill is invoked]

**Arguments**: $ARGUMENTS
```

#### Built-in Skills (No Setup Needed)

These are already available in Claude Code:

| Skill | Purpose |
|-------|---------|
| `/init` | Initialize CLAUDE.md with codebase documentation |
| `/review` | Review a pull request |
| `/security-review` | Security review of pending changes |
| `/simplify` | Review changed code for quality and efficiency |
| `/commit` | Create a git commit (use via `/commit` in the CLI) |

#### Recommended Custom Skills to Create

**1. `/cleanup` - Housekeeping**

Create `.claude/skills/cleanup/SKILL.md`:
```markdown
---
name: cleanup
description: Run housekeeping cleanup checklist
user-invocable: true
---

Perform comprehensive housekeeping cleanup on the codebase.

Follow the complete checklist from `.claude/housekeeping.md`:
1. Debug code removal
2. Documentation cleanup
3. Code cleanup
4. Folder structure check
5. File cleanup

Report findings and suggest removals.

Arguments: $ARGUMENTS
```

**2. `/update-docs` - Documentation Update**

Create `.claude/skills/update-docs/SKILL.md`:
```markdown
---
name: update-docs
description: Update all relevant documentation
user-invocable: true
---

Update documentation to reflect recent code changes.

Check all documentation files and update consistently.

Follow standards from `.claude/housekeeping.md`.

Arguments: $ARGUMENTS
```

**3. `/plan` - Implementation Planning**

Create `.claude/skills/plan/SKILL.md`:
```markdown
---
name: plan
description: Create a detailed implementation plan or PRD for a feature
user-invocable: true
---

Create a comprehensive implementation plan for the specified feature.

Steps:
1. Analyze the codebase to understand current architecture
2. Break the feature into subtasks with dependencies
3. Identify all impacts (code, docs, tests, cleanup)
4. Plan testing approach
5. Create cleanup checklist per `.claude/housekeeping.md`

If using PRD workflow, create PRD in `prds/01-planning/` with naming convention: `YYYY-MM-DD - feature-name.md`

Arguments: $ARGUMENTS
```

**4. `/feature` - Full Feature Workflow**

Create `.claude/skills/feature/SKILL.md`:
```markdown
---
name: feature
description: Full feature development workflow with review points
user-invocable: true
---

Execute the complete feature development workflow:

1. **Planning** - Create implementation plan (see `/plan`)
   - Present plan to user for review
   - STOP and wait for approval before proceeding

2. **Implementation** - Execute the plan
   - Follow git flow from `.claude/git-flow-config.md`
   - Present each subtask completion for review

3. **Testing** - Validate functionality
   - Create and run tests
   - Report results

4. **Documentation & Cleanup**
   - Update all relevant documentation
   - Run housekeeping checklist from `.claude/housekeeping.md`

5. **Completion**
   - Present summary of all changes
   - Create PR if using feature-branch git flow

Arguments: $ARGUMENTS
```

**5. `/tech-debt-review` - Technical Debt Review**

Create `.claude/skills/tech-debt-review/SKILL.md`:
```markdown
---
name: tech-debt-review
description: Review technical debt and suggest improvements
user-invocable: true
---

Perform technical debt review:
1. Read current debt from `.claude/technical-debt.md` (if it exists)
2. Scan codebase for new issues
3. Categorize and prioritize
4. Update tracking file
5. Present summary with recommendations

Arguments: $ARGUMENTS
```

#### Domain-Specific Skills

Add project-specific skills for common workflows:
- `/test` - Run test suite with specific configuration
- `/migrate` - Database migration workflow
- `/deploy` - Deployment checklist
- `/release` - Release preparation steps

### Step 6: Configure Claude for Specialized Tasks

Instead of creating separate agent files, configure Claude's behavior through **CLAUDE.md** and **housekeeping.md**. Claude Code automatically applies the right expertise based on context.

**For code review needs**: Use the built-in `/review` skill or `/simplify` skill.

**For documentation tasks**: Reference `.claude/housekeeping.md` documentation standards in your CLAUDE.md.

**For cleanup tasks**: Use the custom `/cleanup` skill created in Step 5.

**For testing**: Add testing philosophy and guidelines directly to CLAUDE.md:

```markdown
## Testing Philosophy

- Tests exist to catch bugs, not to boost coverage numbers
- Mock only external dependencies (APIs, file system, databases), never business logic
- Before writing tests: identify what critical functionality is being tested and what provides real confidence
- Present test strategy for approval before implementing
```

**For frontend UI**: Add component library preferences to CLAUDE.md:

```markdown
## Component Library

This project uses [Library Name]. Always prefer library components over custom UI elements.
Priority: Check library first -> Use if available -> Only build custom when no library component exists.
```

### Step 7: Update .gitignore

Ensure `.claude/` directory is checked into version control.

```gitignore
# Claude Code configuration - tracked for cross-computer sync
!.claude/**/*.md
!CLAUDE.md
```

**What to track:**
- All skill definitions (`.claude/skills/*/SKILL.md`)
- Housekeeping rules (`.claude/housekeeping.md`)
- Git flow configuration (`.claude/git-flow-config.md`)
- This setup guide (`.claude/SETUP_GUIDE.md`)

**What NOT to track:**
- Machine-specific environment files (`.claude/agent-env.md`)
- Files with credentials or secrets

### Step 8: Verify Setup

Check that everything is in place:

```bash
# Verify directory structure
ls -la .claude/
ls -la .claude/skills/

# Verify files exist
cat CLAUDE.md
cat .claude/housekeeping.md
cat .claude/git-flow-config.md

# Check git tracking
git status
```

You should see:
- `CLAUDE.md` at root
- `.claude/housekeeping.md`
- `.claude/git-flow-config.md`
- Custom skill directories in `.claude/skills/`
- All `.claude/` files tracked by git

## Usage After Setup

### Built-in Skills

Claude Code comes with built-in skills that require no setup:

```
/init                    # Initialize CLAUDE.md
/review                  # Review a pull request
/security-review         # Security review of changes
/simplify                # Review code for quality
```

### Custom Skills (Slash Commands)

Invoke your custom workflows:

```
/cleanup                 # Run housekeeping checklist
/update-docs             # Update documentation
/plan "new feature"      # Create implementation plan
/feature "feature name"  # Full feature workflow
/tech-debt-review        # Review technical debt
```

### Housekeeping Enforcement

Reference `.claude/housekeeping.md` in your CLAUDE.md so all interactions follow the rules:
- Remove debug code before finishing
- Update documentation when code changes
- Keep folder structure organized
- No version indicators in naming

## Copying to New Projects

### Quick Copy

```bash
# Copy Claude configuration to new project
cp -r old-project/.claude new-project/.claude

# Run /init in new project to create project-specific CLAUDE.md
```

### What to Customize Per Project

**Always customize:**
- `CLAUDE.md` - Project-specific architecture and commands
- Skills for project-specific workflows

**Usually keep the same:**
- `.claude/housekeeping.md` - Core cleanup rules are universal
- Skill structure and format

## Feature Development Workflow

### Workflow Overview

```
1. Planning
   -> /plan creates implementation plan or PRD
   -> User reviews and approves

2. Implementation
   -> Claude implements subtasks
   -> User reviews each completion

3. Testing
   -> Tests created and run
   -> User reviews test results

4. Documentation & Cleanup
   -> /update-docs updates documentation
   -> /cleanup runs housekeeping
   -> User reviews final changes

5. Completion
   -> Feature merged/completed
```

### Slash Commands for Workflow

**Full workflow** (all stages with review points):
```
/feature [feature-name]
```

**Individual stages**:
```
/plan [feature-name]         # Create implementation plan
/update-docs [scope]         # Update documentation
/cleanup                     # Run housekeeping
/tech-debt-review            # Review technical debt
```

### PRD (Product Requirement Document) Structure (Optional)

If using PRD-driven workflow, organize at root level:

```
prds/
├── 01-planning/       # PRDs being created/reviewed
├── 02-backlog/        # Approved, not yet started
├── 03-implementing/   # Actively being worked on
├── 04-done/           # Completed
└── 05-not-doing/      # Decided against (with rationale)
```

**PRD Naming Convention**: `YYYY-MM-DD - feature-name.md`

## Roadmap & Planning Organization (Optional)

### Simple Milestones (Recommended)

```
.claude/roadmap/
├── README.md
├── vision.md              # Long-term direction
├── ideas/                 # Feature ideas & enhancements
│   ├── misc.md            # Quick idea dump
│   └── [name].md          # Individual idea files
└── milestones.md          # Ordered roadmap
```

**Roadmap vs PRD**:
- **Roadmap**: Brief descriptions, rough concepts, "what" we might build
- **PRD**: Detailed specifications, technical approach, "how" we will build it

### Technical Debt Tracking

Create `.claude/technical-debt.md` for visibility, and use `/tech-debt-review` for regular check-ins.

## Troubleshooting

### Skills Not Working

**Check:**
- Skill file is in `.claude/skills/<name>/SKILL.md`
- YAML frontmatter has `name`, `description`, and `user-invocable: true` fields
- Skill name doesn't conflict with built-in skills

### Housekeeping Rules Not Followed

**Check:**
- `.claude/housekeeping.md` exists
- `CLAUDE.md` references it
- Rules are clear and specific

## Tips

1. **Start minimal**: Create 3-5 skills initially, add more as needed
2. **Use built-ins**: Leverage `/review`, `/simplify`, `/security-review` before building custom equivalents
3. **Iterate on rules**: Update housekeeping.md as you discover project-specific needs
4. **Version control**: Keep `.claude/` in git so it travels with the project
5. **Document decisions**: Update CLAUDE.md when architecture changes
6. **Review periodically**: Run `/cleanup` regularly to prevent cruft

## Example Timeline

**New Project Setup (~15 minutes):**
1. Run `/init` (2 min)
2. Create `.claude/` structure (1 min)
3. Create `housekeeping.md` (3 min)
4. Configure git workflow (2 min)
5. Create custom skills (5 min)
6. Update `.gitignore` (1 min)
7. Verify setup (1 min)

**Ongoing Maintenance:**
- Run `/cleanup` before finishing features
- Update CLAUDE.md when architecture changes
- Add new skills as project grows
