package model_test

import (
	"os"
	"path/filepath"
	"testing"

	"clawbench/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadAgents_EmptyDir(t *testing.T) {
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
	})

	dir := t.TempDir()
	err := model.LoadAgents(dir)
	assert.NoError(t, err)
	assert.Empty(t, model.AgentList)
}

func TestLoadAgents_ValidYAML(t *testing.T) {
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
	})

	dir := t.TempDir()
	yamlContent := `id: test-agent
name: Test Agent
icon: 🤖
specialty: Testing
backend: codebuddy
model: glm-5.1
system_prompt: You are a test agent.
`
	err := os.WriteFile(filepath.Join(dir, "test-agent.yaml"), []byte(yamlContent), 0644)
	require.NoError(t, err)

	err = model.LoadAgents(dir)
	assert.NoError(t, err)
	assert.NotNil(t, model.Agents["test-agent"])
	assert.Equal(t, "Test Agent", model.Agents["test-agent"].Name)
	assert.Equal(t, "codebuddy", model.Agents["test-agent"].Backend)
	assert.Len(t, model.AgentList, 1)
}

func TestLoadAgents_SkipsNonYAML(t *testing.T) {
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
	})

	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("not a yaml"), 0644)
	os.WriteFile(filepath.Join(dir, "no-id.yaml"), []byte("name: No ID Agent\n"), 0644)

	err := model.LoadAgents(dir)
	assert.NoError(t, err)
	assert.Empty(t, model.AgentList)
}

func TestLoadAgents_MultipleAgents(t *testing.T) {
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
	})

	dir := t.TempDir()
	yaml1 := `id: agent-1
name: Agent One
icon: "1"
specialty: One
backend: claude
system_prompt: Prompt 1
`
	yaml2 := `id: agent-2
name: Agent Two
icon: "2"
specialty: Two
backend: codebuddy
system_prompt: Prompt 2
`
	os.WriteFile(filepath.Join(dir, "agent1.yaml"), []byte(yaml1), 0644)
	os.WriteFile(filepath.Join(dir, "agent2.yaml"), []byte(yaml2), 0644)

	err := model.LoadAgents(dir)
	assert.NoError(t, err)
	assert.Len(t, model.AgentList, 2)
	assert.NotNil(t, model.Agents["agent-1"])
	assert.NotNil(t, model.Agents["agent-2"])
}

func TestLoadAgents_CommonPromptGenerated(t *testing.T) {
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
		model.Skills = nil
		model.ServerPort = 0
	})

	dir := t.TempDir()
	model.ServerPort = 20000

	yaml := `id: with-common
name: With Common
icon: "C"
specialty: Common
backend: codebuddy
system_prompt: My specific prompt
`
	os.WriteFile(filepath.Join(dir, "agent.yaml"), []byte(yaml), 0644)

	err := model.LoadAgents(dir)
	assert.NoError(t, err)
	agent := model.Agents["with-common"]
	assert.NotNil(t, agent)
	// Common prompt is now rules.md + skills table; without skills only agent prompt is present
	assert.Contains(t, agent.SystemPrompt, "My specific prompt")
}

func TestLoadAgents_CommonPromptOnlyNoSystemPrompt(t *testing.T) {
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
		model.Skills = nil
		model.ServerPort = 0
	})

	dir := t.TempDir()
	model.ServerPort = 20000

	yaml := `id: no-prompt
name: No Prompt
icon: "N"
specialty: None
backend: claude
`
	os.WriteFile(filepath.Join(dir, "agent.yaml"), []byte(yaml), 0644)

	err := model.LoadAgents(dir)
	assert.NoError(t, err)
	agent := model.Agents["no-prompt"]
	assert.NotNil(t, agent)
	// When agent has no system_prompt and no skills/rules, system prompt is empty
	assert.Empty(t, agent.SystemPrompt)
}

func TestLoadAgents_AvailableAgentsInSkillBody(t *testing.T) {
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
		model.Skills = nil
		model.ServerPort = 0
	})

	skillsDir := t.TempDir()
	agentsDir := t.TempDir()
	model.ServerPort = 20000

	// Write a skill with {{AVAILABLE_AGENTS}} in body
	skillContent := `---
name: scheduled-tasks
description: Schedule tasks
triggers:
  - scheduling
---
agent_id field: {{AVAILABLE_AGENTS}}
`
	err := os.WriteFile(filepath.Join(skillsDir, "scheduled-tasks.md"), []byte(skillContent), 0644)
	require.NoError(t, err)

	yaml1 := `id: codebuddy
name: CodeBuddy
icon: "A"
specialty: General
backend: codebuddy
system_prompt: You are codebuddy.
`
	yaml2 := `id: coder
name: Coder
icon: "C"
specialty: Code
backend: claude
system_prompt: You are coder.
`
	os.WriteFile(filepath.Join(agentsDir, "codebuddy.yaml"), []byte(yaml1), 0644)
	os.WriteFile(filepath.Join(agentsDir, "coder.yaml"), []byte(yaml2), 0644)

	// Load skills first
	err = model.LoadSkills(skillsDir, 20000)
	require.NoError(t, err)

	// Load agents
	err = model.LoadAgents(agentsDir)
	assert.NoError(t, err)

	// Verify {{AVAILABLE_AGENTS}} was replaced in skill body
	skill := model.GetSkillByFilename("scheduled-tasks.md")
	require.NotNil(t, skill)
	assert.NotContains(t, skill.Body, "{{AVAILABLE_AGENTS}}")
	assert.Contains(t, skill.Body, "codebuddy")
	assert.Contains(t, skill.Body, "coder")
}

func TestLoadAgents_NonExistentDir(t *testing.T) {
	err := model.LoadAgents("/non/existent/directory")
	assert.Error(t, err)
}

func TestLoadAgents_InvalidYAML(t *testing.T) {
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
	})

	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "bad.yaml"), []byte("::invalid yaml::\n  [bad"), 0644)

	err := model.LoadAgents(dir)
	assert.NoError(t, err)
	assert.Empty(t, model.AgentList)
}

func TestGetDefaultAgentID_Configured(t *testing.T) {
	model.DefaultAgentID = "coder"
	model.Agents = map[string]*model.Agent{"coder": {ID: "coder"}}
	model.AgentList = []*model.Agent{{ID: "assistant"}, {ID: "coder"}}
	t.Cleanup(func() {
		model.DefaultAgentID = ""
		model.Agents = nil
		model.AgentList = nil
	})

	assert.Equal(t, "coder", model.GetDefaultAgentID())
}

func TestGetDefaultAgentID_ConfiguredNotFound(t *testing.T) {
	model.DefaultAgentID = "nonexistent"
	model.Agents = map[string]*model.Agent{"codebuddy": {ID: "codebuddy"}}
	model.AgentList = []*model.Agent{{ID: "codebuddy"}}
	t.Cleanup(func() {
		model.DefaultAgentID = ""
		model.Agents = nil
		model.AgentList = nil
	})

	// Configured agent not found, fallback to first in list
	assert.Equal(t, "codebuddy", model.GetDefaultAgentID())
}

func TestGetDefaultAgentID_FallbackFirst(t *testing.T) {
	model.DefaultAgentID = ""
	model.Agents = map[string]*model.Agent{"coder": {ID: "coder"}}
	model.AgentList = []*model.Agent{{ID: "coder"}}
	t.Cleanup(func() {
		model.Agents = nil
		model.AgentList = nil
	})

	assert.Equal(t, "coder", model.GetDefaultAgentID())
}

func TestGetDefaultAgentID_NoAgents(t *testing.T) {
	model.DefaultAgentID = ""
	model.Agents = nil
	model.AgentList = nil

	assert.Equal(t, "", model.GetDefaultAgentID())
}
