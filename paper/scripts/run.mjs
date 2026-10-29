import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { benchmark, runTasks } from '../../dist/index.js';
import { mulberry32 } from 'benchmark-core';
import { wilson, bootstrap, mean } from '../template/stats.mjs';
export const read = p => JSON.parse(readFileSync(`paper/${p}`, 'utf8'));
export const save = (p, v) => writeFileSync(`paper/${p}`, JSON.stringify(v) + '\n');
export const hash = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const tasks = await benchmark.listTasks();
function adapter(policy, hazard = 0, seed = 1, recovery = true) {
  const states = new Map();
  return { id: policy, async complete() { throw Error('Episode adapter only'); }, async chat(req, ctx) {
    const task = ctx.task;
    if (!states.has(task.id)) states.set(task.id, { step: 1, token: task.input.initialToken, random: mulberry32(task.metadata.seed ^ Math.imul(seed, 1000003)), drawn: 0 });
    const s = states.get(task.id), stop = content => ({ content, toolCalls: [] });
    const call = (name, args) => ({ content: '', toolCalls: [{ id: `c${ctx.turn}`, name, args }] });
    if (policy === 'oracle') return { content: '', toolCalls: benchmark.definition.mockPolicies.good(task)[0].toolCalls.map((c, i) => ({ ...c, id: `c${i}` })) };
    if (['empty', 'constant', 'echo', 'refusal'].includes(policy)) return stop({ empty: '', constant: 'yes', echo: task.prompt, refusal: 'I cannot complete this workflow.' }[policy]);
    const last = req.messages.filter(m => m.role === 'tool').at(-1);
    if (policy === 'first-tool' && last) return stop('done');
    if (last) {
      const out = JSON.parse(last.content);
      if (out.error) {
        if (!recovery || policy === 'no-recovery' || policy === 'stale-token') return stop('error');
        if (out.error.code === 'ROLLBACK_REQUIRED') {
          if (policy === 'retry-only') return stop('rollback unavailable');
          return call('rollback', { checkpointStep: s.step - 1, token: s.token });
        }
        if (out.error.code !== 'TRANSIENT') return stop('unexpected error');
      } else if (out.step) {
        s.step = out.step + 1;
        if (policy !== 'stale-token') s.token = out.token;
        if (out.complete) return stop('complete');
      }
    }
    if (s.drawn !== s.step) { s.drawn = s.step; if (s.random() < hazard) return stop('simulated omission'); }
    return call('advance', { step: s.step, token: s.token });
  } };
}
async function collect(policy, hazard = 0, seed = 1, recovery = true, full = false) {
  const report = await runTasks(benchmark, adapter(policy, hazard, seed, recovery), { seed, concurrency: 1, retries: 0 });
  const rows = [];
  for (const row of report.rows) {
    assert.ok(!row.error, row.error);
    const grade = await benchmark.score(await benchmark.getTask(row.taskId), row.submission, { seed });
    assert.equal(grade.score, row.score);
    rows.push({ taskId: row.taskId, score: grade.score, state: grade.details, toolLog: row.submission.toolLog, ...(full ? { submission: row.submission, transcript: row.episode.transcript } : {}) });
  }
  return { policy, hazard, seed, recovery, rows };
}
const grouped = rows => [...new Set(tasks.map(t => t.input.workflow))].map(w => rows.filter(r => tasks.find(t => t.id === r.taskId).input.workflow === w));
const survival = r => r.state.completedSteps / r.state.totalSteps;
export function summarize(controls, simulated) {
  const control = controls.map(c => ({ policy: c.policy, completion: wilson(c.rows.filter(r => r.state.finalSuccess).length, c.rows.length), score: bootstrap([grouped(c.rows)], gs => mean(gs[0].flat().map(r => r.score))), survival: bootstrap([grouped(c.rows)], gs => mean(gs[0].flat().map(survival))), calls: mean(c.rows.map(r => r.toolLog.length)) }));
  const simulation = [], contrasts = [];
  const meanCompletion = (run, length) => mean(run.rows.filter(r => !length || r.state.totalSteps === length).map(r => Number(r.state.finalSuccess)));
  for (const hazard of [0, .005, .01, .02]) {
    for (const recovery of [false, true]) for (const length of [0, 25, 50, 75, 100]) {
      const runs = simulated.filter(r => r.hazard === hazard && r.recovery === recovery);
      simulation.push({ hazard, recovery, length, completion: bootstrap([runs], gs => mean(gs[0].map(r => meanCompletion(r, length)))) });
    }
    const pairs = simulated.filter(r => r.hazard === hazard && r.recovery).map(r => [r, simulated.find(x => x.hazard === hazard && !x.recovery && x.seed === r.seed)]);
    contrasts.push({ hazard, recoveryGain: bootstrap([pairs], gs => mean(gs[0].map(([a, b]) => meanCompletion(a) - meanCompletion(b)))) });
  }
  const pairs = simulated.filter(r => r.hazard === 0 && r.recovery).map(r => [r, simulated.find(x => x.hazard === .02 && x.recovery && x.seed === r.seed)]);
  const hazardLoss = bootstrap([pairs], gs => mean(gs[0].map(([a, b]) => meanCompletion(a) - meanCompletion(b))));
  return { control, simulation, contrasts, hazardLoss, taskCount: tasks.length, simulationEpisodes: simulated.length * tasks.length, seedCount: 24, coverage: [25,50,75,100].map(length => { const ts = tasks.filter(t => t.input.length === length); return { length, tasks: ts.length, transient: ts.flatMap(t => t.metadata.failures).filter(f => f.kind === 'transient').length, rollback: ts.flatMap(t => t.metadata.failures).filter(f => f.kind === 'rollback').length }; }), freeModels: 'Not configured or probed; no learned-model scores.' };
}
if (process.argv[1]?.endsWith('/run.mjs')) {
  const controls = [], simulated = [], repeat = [];
  for (const p of ['oracle','reactive','no-recovery','retry-only','stale-token','empty','constant','echo','refusal','first-tool']) {
    const a = await collect(p, 0, 1, true, true), b = await collect(p, 0, 1, true, true);
    assert.equal(hash(a), hash(b)); controls.push(a); repeat.push({ policy: p, first: hash(a), second: hash(b) });
  }
  for (const hazard of [0, .005, .01, .02]) for (const recovery of [false, true]) for (let seed = 1; seed <= 24; seed++) {
    const a = await collect('simulated', hazard, seed, recovery), b = await collect('simulated', hazard, seed, recovery);
    assert.equal(hash(a), hash(b)); simulated.push(a); repeat.push({ hazard, recovery, seed, first: hash(a), second: hash(b) });
  }
  const forged = [];
  for (const task of tasks) { const grade = await benchmark.score(task, { toolLog: [], finalState: { completedSteps: task.input.length, finalSuccess: true } }); assert.equal(grade.score, 0); forged.push({ taskId: task.id, score: grade.score }); }
  save('data/controls.generated.json', controls); save('data/simulated.generated.json', simulated); save('data/repeat.generated.json', repeat); save('data/forged.generated.json', forged); save('data/summary.generated.json', summarize(controls, simulated));
  const files = ['src/benchmark.ts','data/tasks.jsonl','package-lock.json','paper/PREREG.md','paper/scripts/run.mjs','paper/template/stats.mjs'];
  save('data/provenance.generated.json', { sourceCommit: read('config.json').source_commit, planCommit: execFileSync('git',['log','--reverse','--format=%H','--','paper/PREREG.md'],{encoding:'utf8'}).trim().split('\n')[0], hashes: Object.fromEntries(files.map(f => [f, hash(readFileSync(f, 'utf8'))])), semanticHash: hash({ controls, simulated }), simulated: true, spendUsd: 0 });
  console.log(`Collected ${controls.length * tasks.length} control episodes and ${simulated.length * tasks.length} simulated episodes; repeats match.`);
}
