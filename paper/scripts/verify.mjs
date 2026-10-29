import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { benchmark } from '../../dist/index.js';
import { read, save, hash, summarize } from './run.mjs';
const controls = read('data/controls.generated.json'), sim = read('data/simulated.generated.json'), provenance = read('data/provenance.generated.json');
assert.deepEqual(summarize(controls, sim), read('data/summary.generated.json'));
assert.equal(hash({controls, simulated:sim}), provenance.semanticHash);
for (const [p,h] of Object.entries(provenance.hashes)) assert.equal(hash(readFileSync(p,'utf8')), h, p);
for (const p of ['src/benchmark.ts','data/tasks.jsonl','package-lock.json']) assert.equal(hash(execFileSync('git',['show',`${provenance.sourceCommit}:${p}`],{encoding:'utf8'})), provenance.hashes[p]);
let replayed = 0;
for (const run of [...controls,...sim]) for (const row of run.rows) {
  const task = await benchmark.getTask(row.taskId), grade = await benchmark.score(task,{toolLog:row.toolLog});
  assert.equal(grade.score,row.score); assert.deepEqual(grade.details,row.state); replayed++;
  if (row.state.finalSuccess) { assert.equal(row.state.completedSteps,task.input.length); assert.equal(row.state.recoveries,task.metadata.failures.length); assert.equal(row.score,1); }
}
assert.equal(replayed,4848);
for (const row of read('data/repeat.generated.json')) assert.equal(row.first,row.second);
for (const row of read('data/forged.generated.json')) { const task = await benchmark.getTask(row.taskId); assert.equal((await benchmark.score(task,{toolLog:[],finalState:{completedSteps:task.input.length,finalSuccess:true}})).score,row.score); assert.equal(row.score,0); }
const meta=read('meta.json'); assert.equal(meta.title,read('config.json').title); assert.ok(meta.abstract.length<=1920&&/^[\x00-\x7F]*$/.test(meta.abstract)); assert.equal(meta.license,'CC-BY-4.0');
const text=execFileSync('pdftotext',['paper/'+meta.artifact_name,'-'],{encoding:'utf8'}), info=execFileSync('pdfinfo',['paper/'+meta.artifact_name],{encoding:'utf8'}), pages=Number(/Pages:\s+(\d+)/.exec(info)[1]);
assert.ok(pages>=8); assert.ok(!text.includes('—')); assert.ok(!/undefined|Overfull/.test(readFileSync('paper/paper.log','utf8'))); assert.ok(!text.includes('??'));
const templateHashes=Object.fromEntries(readdirSync('paper/template').map(f=>[f,hash(readFileSync('paper/template/'+f,'utf8'))]));
save('data/verification.generated.json',{replayed,pages,semanticHash:provenance.semanticHash,repeatCells:read('data/repeat.generated.json').length,templateHashes,checks:'summary, replay, repeat, frozen source, metadata, PDF text and layout passed'});
console.log(`Verified ${replayed} replayed episodes, 202 repeat cells, ${pages} PDF pages; all checks passed.`);
