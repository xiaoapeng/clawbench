import { describe, it, expect } from 'vitest'
import { isValidAskContent, detectAskQuestion } from '../streamPerf'

describe('isValidAskContent', () => {
  it('accepts standard JSON object with questions array', () => {
    const raw = '{"questions":[{"question":"Pick one","header":"Choice","options":[{"label":"A","description":"Fast"}],"multiSelect":false}]}'
    expect(isValidAskContent(raw)).toBe(true)
  })

  it('accepts parameter wrapper with bare questions array', () => {
    const raw = '<parameter name="questions">[{"question":"Pick one","header":"Choice","options":[{"label":"A","description":"Fast"}],"multiSelect":false}]</parameter>'
    expect(isValidAskContent(raw)).toBe(true)
  })

  it('accepts parameter wrapper with questions object', () => {
    const raw = '<parameter name="questions">{"questions":[{"question":"Pick one","header":"Choice","options":[{"label":"A","description":"Fast"}],"multiSelect":false}]}</parameter>'
    expect(isValidAskContent(raw)).toBe(true)
  })

  it('accepts bare questions array without wrapper', () => {
    const raw = '[{"question":"Pick one","header":"Choice","options":[{"label":"A","description":"Fast"}],"multiSelect":false}]'
    expect(isValidAskContent(raw)).toBe(true)
  })

  it('accepts markdown code fence with parameter wrapper', () => {
    const raw = '```json\n<parameter name="questions">[{"question":"Pick one","header":"Choice","options":[{"label":"A","description":"Fast"}],"multiSelect":false}]</parameter>\n```'
    expect(isValidAskContent(raw)).toBe(true)
  })

  it('rejects plain text (not JSON)', () => {
    const raw = 'This is just text, not JSON at all'
    expect(isValidAskContent(raw)).toBe(false)
  })

  it('rejects JSON object without questions field', () => {
    const raw = '{"data":"something"}'
    expect(isValidAskContent(raw)).toBe(false)
  })

  it('rejects empty array', () => {
    const raw = '[]'
    expect(isValidAskContent(raw)).toBe(false)
  })
})

describe('detectAskQuestion', () => {
  it('detects standard <ask-question> with JSON object', () => {
    const text = 'Some text before\n<ask-question>{"questions":[{"question":"Which?","header":"Choice","options":[{"label":"A","description":"Fast"}],"multiSelect":false}]}</ask-question>'
    const result = detectAskQuestion(text)
    expect(result.found).toBe(true)
    expect(result.startIdx).toBeGreaterThanOrEqual(0)
  })

  it('detects <ask-question> with <parameter> wrapper and bare array', () => {
    const text = '工作区是干净的。\n\n<ask-question>\n<parameter name="questions">[{"header": "下一步", "multiSelect": false, "options": [{"label": "推送到远程", "description": "推送提交"}, {"label": "取消", "description": "不做任何操作"}], "question": "你想做什么？"}]</parameter>\n</ask-question>'
    const result = detectAskQuestion(text)
    expect(result.found).toBe(true)
    expect(result.startIdx).toBeGreaterThanOrEqual(0)
  })

  it('returns found=false for text without <ask-question>', () => {
    const text = 'Just some regular text without any ask-question tags'
    const result = detectAskQuestion(text)
    expect(result.found).toBe(false)
  })

  it('detects <ask-question> with obfuscated closing tag (fullwidth pipe)', () => {
    // Real case from message 510: model emits </｜｜DSML｜｜question> instead of </ask-question>
    const text = '`gh` 已给出设备认证码。需要在浏览器中完成登录：\n\n<ask-question>\n{"questions":[{"header":"GitHub 认证","multiSelect":false,"options":[{"label":"已打开链接","description":"我已在浏览器中完成认证，继续推送"},{"label":"我手动来","description":"我自己执行 gh auth login -w 完成登录后手动推送"}],"question":"请打开 https://github.com/login/device 并输入代码完成登录。完成后告诉我。"}]}\n</｜｜DSML｜｜question>'
    const result = detectAskQuestion(text)
    expect(result.found).toBe(true)
    expect(result.startIdx).toBeGreaterThanOrEqual(0)
    expect(result.content).toBeDefined()
    // The content should be parseable as JSON with questions
    expect(isValidAskContent(result.content!)).toBe(true)
  })
})
