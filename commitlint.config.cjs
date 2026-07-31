const conventionalTypes = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
]

const IGNORE_PATTERNS = [
  /^Merge /,
  /^Resolve merge conflict/,
  /^Auto-merge/,
]

module.exports = {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: true,
  rules: {
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    'header-max-length': [2, 'always', 100],
    'subject-case': [0],
    'subject-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'type-enum': [2, 'always', conventionalTypes],
  },
  ignores: [
    (commit) => IGNORE_PATTERNS.some((pattern) => pattern.test(commit)),
  ],
}
