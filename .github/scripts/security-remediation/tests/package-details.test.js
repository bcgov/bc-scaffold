const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCategoryDetailSections } = require('../issue-template/package-details');
const { getCategory } = require('../issue-template/plan-helpers');

function render(vulnerabilities) {
  const plan = {
    package: { name: 'yaml', ecosystem: 'npm', relationship: 'transitive',
      current_version_range: 'unknown', minimum_fixed_version: '2.8.3', vulnerabilities,
      dependency_occurrences: ['1.10.2', '2.8.1'].map(version => ({ package: 'yaml', version,
        introducers: [{ package: 'parent', version: '1.0.0' }] })) },
    fix: { fix_class: 'NO_FIX_AVAILABLE' }, action: { action_type: 'open_issue' }, state: {},
  };
  return buildCategoryDetailSections('npm', { [getCategory(plan)]: [plan] }, new Set([plan]), () => []);
}

test('multi-version findings retain advisory-specific patched versions and paths', () => {
  const body = render([
    { ghsa_id: 'GHSA-one', vulnerable_range: '>= 1.0.0, < 1.10.3', first_patched: '1.10.3' },
    { ghsa_id: 'GHSA-two', vulnerable_range: '>= 2.0.0, < 2.8.3', first_patched: '2.8.3' },
  ]);
  assert.match(body, /<code>yaml<\/code>: <code>1\.10\.2<\/code> -> <code>1\.10\.3<\/code>; <code>2\.8\.1<\/code> -> <code>2\.8\.3<\/code>/);
  assert.match(body, /Transitive dependency \*\*yaml 1\.10\.2\*\*/);
  assert.match(body, /Transitive dependency \*\*yaml 2\.8\.1\*\*/);
  assert.match(body, /GHSA-one/);
  assert.match(body, /GHSA-two/);
});

test('unsupported or missing advisory evidence does not imply a shared upgrade target', () => {
  for (const range of ['^1.0.0', undefined]) {
    const body = render([{ vulnerable_range: range, first_patched: '2.8.3' }]);
    assert.match(body, /<code>1\.10\.2<\/code> -> requires advisory review/);
    assert.doesNotMatch(body, /<code>1\.10\.2<\/code> -> <code>2\.8\.3<\/code>/);
  }
});
