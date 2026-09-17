import test from 'node:test';
import assert from 'node:assert/strict';
import { expandPlayerStatistics, demoPlayerMilestones } from '../src/player-statistics.js';
import { historySchema } from '../src/history.js';

test('statistics preserve supplied zeros, distinguish missing data and fielding from dismissals', () => {
  const result = expandPlayerStatistics([
    { format: 'TEST', label: '300s', value: '0' },
    { format: 'TEST', label: 'Dismissed caught', value: '8' },
    { format: 'TEST', label: 'Catches taken', value: '12' },
    { format: 'TEST', label: 'Provider-specific statistic', value: '3' }
  ]);
  const find = label => result.find(r => r.format === 'TEST' && r.label === label);
  assert.equal(find('300s').value, '0');
  assert.equal(find('Golden ducks').value, null);
  assert.equal(find('Dismissed caught').group, 'Dismissals');
  assert.equal(find('Catches taken').group, 'Fielding');
  assert.equal(find('Provider-specific statistic').value, '3');
  assert.equal(find('Provider-specific statistic').group, 'Other available statistics');
  assert.ok(result.some(r => r.format === 'ODI' && r.label === '200s'));
  assert.match(find('100s').definition, /including double and triple/);
});

test('history import accepts full-format statistics but rejects ambiguous duplicate labels', () => {
  const statistics = expandPlayerStatistics(demoPlayerMilestones('arjun-mehta')).map(({ format, label, value }) => ({ format, label, value }));
  assert.ok(statistics.length > 60);
  const profile = { id: 'test-player', kind: 'player', name: 'Test Player', team: 'IND', biography: '', careerStart: 2000, careerEnd: null, statistics, achievements: [] };
  const payload = { profiles: [profile], rankings: [], records: [], sourceLabel: 'Test fixture' };
  assert.equal(historySchema.safeParse(payload).success, true);
  assert.equal(historySchema.safeParse({ ...payload, profiles: [{ ...profile, statistics: [...statistics, statistics[0]] }] }).success, false);
});
