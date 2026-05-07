package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadSkills(t *testing.T) {
	t.Cleanup(func() {
		Skills = nil
	})

	dir := t.TempDir()

	skillContent := `---
name: test-skill
description: A test skill for unit testing
triggers:
  - when user asks about testing
  - when writing tests
---

## Test Skill Details

This is the detailed content of the test skill.
`
	err := os.WriteFile(filepath.Join(dir, "test-skill.md"), []byte(skillContent), 0644)
	require.NoError(t, err)

	noFrontmatter := "This file has no frontmatter and should be skipped.\n"
	err = os.WriteFile(filepath.Join(dir, "no-frontmatter.md"), []byte(noFrontmatter), 0644)
	require.NoError(t, err)

	portSkill := `---
name: port-skill
description: Skill with port {{PORT}}
triggers:
  - when needing port info
---

API endpoint: http://localhost:{{PORT}}/api/test
`
	err = os.WriteFile(filepath.Join(dir, "port-skill.md"), []byte(portSkill), 0644)
	require.NoError(t, err)

	err = LoadSkills(dir, 20000)
	require.NoError(t, err)

	assert.Len(t, Skills, 2)
	assert.Equal(t, "port-skill", Skills[0].Name)
	assert.Equal(t, "test-skill", Skills[1].Name)
	assert.Equal(t, "A test skill for unit testing", Skills[1].Description)
	assert.Equal(t, []string{"when user asks about testing", "when writing tests"}, Skills[1].Triggers)
	assert.Equal(t, "test-skill.md", Skills[1].Filename)
	assert.Equal(t, "Skill with port 20000", Skills[0].Description)
	assert.Contains(t, Skills[0].Body, "http://localhost:20000/api/test")
	assert.Contains(t, Skills[1].Body, "This is the detailed content")
}

func TestLoadSkillsEmptyDir(t *testing.T) {
	t.Cleanup(func() {
		Skills = nil
	})

	dir := t.TempDir()
	err := LoadSkills(dir, 20000)
	require.NoError(t, err)
	assert.Empty(t, Skills)
}

func TestLoadSkillsNonexistentDir(t *testing.T) {
	err := LoadSkills("/nonexistent/path", 20000)
	assert.Error(t, err)
}

func TestBuildSkillsTable(t *testing.T) {
	skills := []Skill{
		{Name: "alpha", Description: "First skill", Triggers: []string{"trigger a", "trigger b"}, Filename: "alpha.md"},
		{Name: "beta", Description: "Second skill", Triggers: []string{"trigger c"}, Filename: "beta.md"},
	}

	table := buildSkillsTable(skills)

	assert.Contains(t, table, "| alpha | trigger a, trigger b | alpha.md |")
	assert.Contains(t, table, "| beta | trigger c | beta.md |")
	assert.NotContains(t, table, "| Skill |")
}

func TestBuildCommonPrompt(t *testing.T) {
	t.Cleanup(func() {
		Skills = nil
		ServerPort = 0
		Agents = nil
		AgentList = nil
	})

	Skills = []Skill{
		{Name: "test-skill", Description: "Test", Triggers: []string{"test trigger"}, Filename: "test-skill.md"},
	}
	ServerPort = 20000
	Agents = map[string]*Agent{
		"coder": {ID: "coder", Specialty: "coding"},
	}
	AgentList = []*Agent{{ID: "coder", Specialty: "coding"}}

	// Use temp dir with rules.md
	tmpDir := t.TempDir()
	agentsDir := filepath.Join(tmpDir, "agents")
	require.NoError(t, os.MkdirAll(agentsDir, 0755))
	// No rules.md — should still work, just no rules section

	prompt := buildCommonPrompt(agentsDir)

	assert.Contains(t, prompt, "## Skills")
	assert.Contains(t, prompt, "Server port: 20000")
	assert.Contains(t, prompt, "| Skill | Triggers | File |")
	assert.Contains(t, prompt, "| test-skill | test trigger | test-skill.md |")
	assert.Contains(t, prompt, "curl http://localhost:20000/api/skills/{filename}")
}

func TestBuildCommonPromptWithRules(t *testing.T) {
	t.Cleanup(func() {
		Skills = nil
		ServerPort = 0
		Agents = nil
		AgentList = nil
	})

	Skills = nil
	ServerPort = 20000
	Agents = map[string]*Agent{
		"coder": {ID: "coder", Specialty: "coding"},
	}
	AgentList = []*Agent{{ID: "coder", Specialty: "coding"}}

	// Create temp dir with rules.md
	tmpDir := t.TempDir()
	agentsDir := filepath.Join(tmpDir, "agents")
	require.NoError(t, os.MkdirAll(agentsDir, 0755))

	rulesContent := "## Rules\n\nAlways use {{PORT}} for API calls.\nAgents:\n{{AVAILABLE_AGENTS}}\n"
	err := os.WriteFile(filepath.Join(tmpDir, "rules.md"), []byte(rulesContent), 0644)
	require.NoError(t, err)

	prompt := buildCommonPrompt(agentsDir)

	// Rules should be injected with placeholders replaced
	assert.Contains(t, prompt, "## Rules")
	assert.Contains(t, prompt, "Always use 20000 for API calls.")
	assert.Contains(t, prompt, "coder: coding")
	assert.NotContains(t, prompt, "{{PORT}}")
	assert.NotContains(t, prompt, "{{AVAILABLE_AGENTS}}")
}

func TestParseSkillFrontmatter(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		filename   string
		wantName   string
		wantDesc   string
		wantTrigs  int
		wantBody   string
		wantErr    bool
	}{
		{
			name: "valid frontmatter",
			content: `---
name: my-skill
description: My skill
triggers:
  - trigger 1
---
Content here`,
			filename:  "my-skill.md",
			wantName:  "my-skill",
			wantDesc:  "My skill",
			wantTrigs: 1,
			wantBody:  "Content here",
		},
		{
			name:     "no frontmatter",
			content:  "Just content, no frontmatter.",
			filename: "plain.md",
			wantName: "",
		},
		{
			name: "empty frontmatter",
			content: `---
---
Content here`,
			filename: "empty.md",
			wantErr:  true,
		},
		{
			name: "frontmatter without name",
			content: `---
description: Has desc but no name
---
Content`,
			filename: "no-name.md",
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skill, err := parseSkillFrontmatter([]byte(tt.content), tt.filename, 20000)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantName, skill.Name)
			if tt.wantDesc != "" {
				assert.Equal(t, tt.wantDesc, skill.Description)
			}
			if tt.wantTrigs > 0 {
				assert.Len(t, skill.Triggers, tt.wantTrigs)
			}
			if tt.wantBody != "" {
				assert.Contains(t, skill.Body, tt.wantBody)
			}
			assert.Equal(t, tt.filename, skill.Filename)
		})
	}
}

func TestSkillTableInjection(t *testing.T) {
	t.Cleanup(func() {
		ServerPort = 0
		Skills = nil
		Agents = nil
		AgentList = nil
	})

	agentsDir := t.TempDir()
	skillsDir := t.TempDir()

	skillContent := `---
name: rag-search
description: Search history
condition: rag.enabled
triggers:
  - searching history
---
Search API here
`
	err := os.WriteFile(filepath.Join(skillsDir, "rag-search.md"), []byte(skillContent), 0644)
	require.NoError(t, err)

	agentYAML := `id: test-agent
name: Test
icon: 🧪
specialty: testing
backend: codebuddy
system_prompt: |
  You are a test assistant.
`
	err = os.WriteFile(filepath.Join(agentsDir, "test-agent.yaml"), []byte(agentYAML), 0644)
	require.NoError(t, err)

	err = LoadSkills(skillsDir, 20000)
	require.NoError(t, err)

	ServerPort = 20000
	err = LoadAgents(agentsDir)
	require.NoError(t, err)

	agent := Agents["test-agent"]
	assert.NotNil(t, agent)
	assert.Contains(t, agent.SystemPrompt, "## Skills")
	assert.Contains(t, agent.SystemPrompt, "| rag-search |")
	assert.Contains(t, agent.SystemPrompt, "You are a test assistant.")
}
