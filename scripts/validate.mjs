import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.equal(scripts.length, 1, 'ScholarOS should contain one inline application script');
new vm.Script(scripts[0], { filename: 'index.html' });

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicates)], [], `duplicate element IDs: ${duplicates.join(', ')}`);

for (const id of [
  'studyConnection',
  'studyBtn',
  'studyLive',
  'studySessionsTable',
  'studyWeekChart',
  'studyCompletionRate',
  'studySubjectBreakdown',
  'studyCaptureList',
  'studyRequestList',
  'alexaConnection',
  'alexaDevice',
  'alexaMessage',
  'alexaRoutine',
  'alexaActionLog',
  'scholarAutopilotBtn',
  'scholarNextTask',
  'memoryType',
  'memoryList',
  'quizQuestion',
  'quizAskAlexaBtn',
  'lockInConnection',
  'lockInBlockedCount',
  'lockInWeekMinutes',
  'lockInRefreshBtn',
]) {
  assert.ok(ids.includes(id), `missing ScholarOS integration element #${id}`);
}

for (const marker of [
  'SCHOLAROS_READY',
  'SCHOLAROS_COMMAND',
  'STUDYX_STATE',
  'STUDYX_EVENTS',
  'studyEventIds',
  'studyStarredSessionIds',
  'SCHOLAROS_ALEXA_REQUEST',
  'STUDYX_ALEXA_RESULT',
  'SCHOLAROS_LOCKIN_REQUEST',
  'STUDYX_LOCKIN_RESULT',
  'resolveUnblock',
  'unblock.resolved',
  'nextScholarTask',
  'scholarMorningText',
  'scholarHint',
]) {
  assert.ok(html.includes(marker), `missing bridge marker ${marker}`);
}

console.log(`Validated ScholarOS: ${ids.length} unique element IDs and a parseable bridge script.`);
