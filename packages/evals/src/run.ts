import type { Lang } from '@vaani/shared'
import { evalCases, evalRuns, id, type Database } from '@vaani/db'
import { scoreCase, scoreSuite, type CaseResult, type SuiteResult } from './score'
import { SCENARIOS, type Scenario, type ToolCallRecord, type Transcript, type Turn } from './scenarios'

/**
 * Driving the agent through a scenario.
 *
 * The agent under test is injected. That keeps the harness honest in two ways:
 * it can run against the real Live session for a full check, or against a
 * scripted stand-in for the deterministic parts — and the *scoring* is
 * identical either way, so a rule that passes offline is the same rule that
 * gets checked online.
 *
 * The simulated caller is a fixed script rather than a second model. A model
 * playing the patient makes every run different, which means a failure cannot
 * be reproduced and a fix cannot be proven. Scripted callers are less lifelike
 * and far more useful.
 */

export interface AgentUnderTest {
  /** One caller turn in, the agent's reply and any tool calls out. */
  say: (text: string, lang: Lang) => Promise<{ reply: string; tools: ToolCallRecord[] }>
  /** Called once before the script, for the greeting. */
  open?: () => Promise<{ reply: string; tools: ToolCallRecord[] }>
  close?: () => Promise<void>
}

export type AgentFactory = (scenario: Scenario) => Promise<AgentUnderTest>

function detectLang(text: string): Lang {
  if (/[ऀ-ॿ]/.test(text)) return 'hi-IN'
  if (/\b(mujhe|chahiye|kar|hai|nahi|theek|kya|aap|bilkul|shaam|kal)\b/i.test(text)) return 'hi-Latn-IN'
  return 'en-IN'
}

export async function runScenario(
  scenario: Scenario,
  factory: AgentFactory,
): Promise<{ transcript: Transcript; result: CaseResult }> {
  const agent = await factory(scenario)
  const turns: Turn[] = []
  const tools: ToolCallRecord[] = []
  const languages = new Set<Lang>()
  let firstResponseMs: number | undefined

  try {
    if (agent.open) {
      const started = Date.now()
      const opening = await agent.open()
      firstResponseMs = Date.now() - started
      if (opening.reply) {
        turns.push({ speaker: 'agent', text: opening.reply, lang: detectLang(opening.reply) })
        languages.add(detectLang(opening.reply))
      }
      tools.push(...opening.tools)
    }

    for (const line of scenario.script) {
      const callerLang = detectLang(line)
      turns.push({ speaker: 'caller', text: line, lang: callerLang })

      const started = Date.now()
      const out = await agent.say(line, callerLang)
      firstResponseMs ??= Date.now() - started

      if (out.reply) {
        const replyLang = detectLang(out.reply)
        turns.push({ speaker: 'agent', text: out.reply, lang: replyLang })
        languages.add(replyLang)
      }
      tools.push(...out.tools)
    }
  } finally {
    await agent.close?.()
  }

  const booked = tools.find((x) => x.name === 'book_appointment' && x.ok)
  const triage = tools.find((x) => x.name === 'triage_symptoms')
  const transcript: Transcript = {
    turns,
    tools,
    agentText: turns.filter((t) => t.speaker === 'agent').map((t) => t.text).join('\n'),
    bookedAppointmentId: (booked?.result as { id?: string } | undefined)?.id,
    escalated: tools.some((x) => x.name === 'escalate_to_human'),
    triageBand: (triage?.result as { band?: string } | undefined)?.band,
    languages: [...languages],
    firstResponseMs,
  }

  return { transcript, result: scoreCase(scenario, transcript) }
}

export interface RunOptions {
  factory: AgentFactory
  scenarios?: Scenario[]
  /** Persist the run, so quality is trackable across model versions. */
  db?: Database
  orgId?: string
  suite?: string
  gitSha?: string
  model?: string
  onCase?: (result: CaseResult) => void
}

export async function runSuite(opts: RunOptions): Promise<SuiteResult> {
  const scenarios = opts.scenarios ?? SCENARIOS
  const results: CaseResult[] = []
  const transcripts = new Map<string, Transcript>()

  for (const scenario of scenarios) {
    try {
      const { result, transcript } = await runScenario(scenario, opts.factory)
      results.push(result)
      transcripts.set(scenario.id, transcript)
      opts.onCase?.(result)
    } catch (err) {
      // A scenario that cannot even run is a failure, not a reason to abandon
      // the suite — the remaining cases still carry information.
      const result: CaseResult = {
        scenarioId: scenario.id,
        title: scenario.title,
        passed: false,
        unsafe: true,
        quality: 0,
        failures: [`MUST ran: ${err instanceof Error ? err.message : String(err)}`],
        scores: { must: 0, should: 0, toolCalls: 0, failedTools: 0, turns: 0, firstResponseMs: 0 },
      }
      results.push(result)
      opts.onCase?.(result)
    }
  }

  const suite = scoreSuite(results)

  if (opts.db) {
    const runId = id('evalrun')
    await opts.db.insert(evalRuns).values({
      id: runId,
      orgId: opts.orgId,
      suite: opts.suite ?? 'default',
      gitSha: opts.gitSha,
      model: opts.model,
      finishedAt: new Date(),
      passed: suite.passed,
      failed: suite.failed,
      scores: { quality: suite.quality, unsafe: suite.unsafe },
    })
    for (const c of results) {
      await opts.db.insert(evalCases).values({
        id: id('evalcase'),
        runId,
        scenario: c.scenarioId,
        passed: c.passed,
        scores: c.scores,
        transcript: (transcripts.get(c.scenarioId)?.turns ?? []).map((t) => ({
          speaker: t.speaker,
          text: t.text,
          lang: t.lang,
          atMs: 0,
        })),
        failures: c.failures,
      })
    }
  }

  return suite
}
