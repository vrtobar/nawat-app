import globals from 'globals';

import base from './base.js';

// Base + Node runtime globals — for plain Node packages (Lambda workers,
// scripts). NestJS apps use eslint/nestjs.js, which extends this.
export default [
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
