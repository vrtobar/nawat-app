import node from './node.js';

export default [
  ...node,
  {
    rules: {
      // NestJS modules/controllers are routinely classes with only
      // decorator metadata and no instance members — that's the intended
      // pattern here, not a code smell.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
