// Per-package detail sections grouped by impact and action.

const { buildAlerts, vulnerabilityTableRows } = require('./alerts');
const { IMP_LABEL, ACT_LABEL, isTransitivePlan, forEachCategory } = require('./plan-helpers');
const { prLinks } = require('./remediation-prs');
const { compareVersions } = require('./versions');

// Display only: associate stable numeric versions with explicit advisory ranges.
// Unsupported syntax stays unassigned rather than implying a remediation target.
function affectedBy(version, range) {
  if (!/^\d+(?:\.\d+)*$/.test(version) || !range) return null;
  const results = range.split('||').map(branch => {
    const terms = branch.split(',').map(term => term.trim());
    const matches = terms.map(term => term.match(/^(<=|>=|<|>|=)?\s*(\d+(?:\.\d+)*)$/));
    if (matches.some(match => !match)) return null;
    return matches.every(([, operator = '=', bound]) => {
      const comparison = compareVersions(version, bound);
      return { '<': comparison < 0, '<=': comparison <= 0, '>': comparison > 0,
        '>=': comparison >= 0, '=': comparison === 0 }[operator];
    });
  });
  return results.includes(true) ? true : results.includes(null) ? null : false;
}

function occurrenceTargets(plan, alerts) {
  const versions = [...new Set((plan.package.dependency_occurrences || [])
    .map(occurrence => occurrence.version).filter(version => version && version !== 'unknown'))];
  if (versions.length < 2) return null;
  return versions.map(version => {
    const relevant = alerts.filter(alert => affectedBy(version, alert.vulnerable_range) !== false);
    const certain = relevant.length && relevant.every(alert => affectedBy(version, alert.vulnerable_range) === true
      && /^\d+(?:\.\d+)*$/.test(alert.first_patched || ''));
    const fixed = certain
      ? relevant.map(alert => alert.first_patched).sort(compareVersions).at(-1)
      : null;
    return { version, fixed };
  });
}

function planStatus(plan) {
  if (plan.action.action_type === 'open_issue') return 'Manual/agent review - tracking issue opened';
  if (plan.action.action_type === 'placeholder_pr') return 'Placeholder - awaiting agent/manual fix';
  return plan.action.pr_number ? 'Remediation PR matched' : 'Awaiting remediation PR';
}

function buildTransitiveDetails(plan) {
  let details = '';
  for (const occurrence of plan.package.dependency_occurrences || []) {
    details += `\nTransitive dependency **${occurrence.package} ${occurrence.version || 'unknown'}** is introduced via\n\n`;
    const paths = (occurrence.paths || []).filter(path => Array.isArray(path) && path.length > 0);
    if (paths.length) {
      for (const path of paths) {
        details += `- ${path.map(node => `${node.package} ${node.version || 'unknown'}`).join(' → ')}\n`;
      }
    } else for (const parent of occurrence.introducers || []) {
      details += `- ${parent.package} ${parent.version || 'unknown'} → ${occurrence.package} ${occurrence.version || 'unknown'}\n`;
    }
    if (!(occurrence.introducers || []).length) details += '_No declared parent found in the lockfile._\n';
    details += '\n';
  }
  const mdNote = plan.action.placeholder_markdown || '';
  const undershoot = mdNote.match(/Existing PR #(\d+) is insufficient[^)]*\(([^)]+)\)/);
  if (undershoot) details += `- **Existing PR**: #${undershoot[1]} undershoots required version - [view](${undershoot[2]})\n`;
  return details;
}

function buildPlanDetailSection(plan) {
  const alerts = buildAlerts(plan);
  const targets = occurrenceTargets(plan, alerts);
  const fixedVersion = plan.package.minimum_fixed_version
    || [...new Set(alerts.map(alert => alert.first_patched).filter(Boolean))].join(', ')
    || 'N/A';

  const versionSummary = targets
    ? targets.map(target => `<code>${target.version}</code> -> ${target.fixed ? `<code>${target.fixed}</code>` : 'requires advisory review'}`).join('; ')
    : `<code>${plan.package.current_version_range}</code> -> <code>${fixedVersion}</code>`;
  let section = `<details>\n<summary><code>${plan.package.name}</code>: ${versionSummary}</summary>\n\n`;
  section += `- **Remediation Status**: ${planStatus(plan)}\n`;
  if (isTransitivePlan(plan)) section += buildTransitiveDetails(plan);

  if (plan.action.pr_number) {
    section += `- **Remediation PR**: #${plan.action.pr_number} ([view](${plan.action.pull_url}))\n`;
  }
  if (plan.state.issue_id) {
    section += `- **Tracking Issue**: #${plan.state.issue_id} ([view](${plan.state.issue_url}))\n`;
  }

  if (alerts.length > 0) {
    section += `**Vulnerabilities**:\n\n| ID | Summary | CVSS | Affected Versions | Fixed In |\n|---|---|---|---|---|\n`;
    section += vulnerabilityTableRows(alerts).join('\n') + '\n\n';
  }

  return section + '</details>\n\n';
}

function buildCategoryDetailSections(ecosystem, categoryMap, groupPlansSet, groupPRs) {
  let body = '';
  forEachCategory(ecosystem, categoryMap, groupPlansSet, (category, plans, impact, action) => {
    if (!body) body = '## Vulnerability Findings & Dependency Graph\n\n';

    if (action === 'placeholder') {
      const placeholderPRs = groupPRs(category) || [];
      if (placeholderPRs.length > 0) {
        body += `**Placeholder PR**: ${prLinks(placeholderPRs)} _(draft - push fixes or assign to agent)_\n\n`;
      }
    }

    for (const plan of plans) body += buildPlanDetailSection(plan);
  });
  return body;
}

module.exports = { buildCategoryDetailSections };
