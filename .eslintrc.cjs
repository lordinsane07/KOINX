module.exports = {
  env: {
    es2024: true,
    node: true,
    jest: true,
  },
  ignorePatterns: ['src/public'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  extends: ['airbnb-base'],
  rules: {
    'import/extensions': ['error', 'ignorePackages'],
    'import/prefer-default-export': 'off',
    'no-underscore-dangle': ['error', { allow: ['_id'] }],
    'no-restricted-syntax': 'off',
    'no-await-in-loop': 'off',
    'class-methods-use-this': 'off',
    'max-len': ['warn', { code: 120, ignoreComments: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
    'no-continue': 'off',
    'no-plusplus': 'off',
    'consistent-return': 'off',
  },
};
