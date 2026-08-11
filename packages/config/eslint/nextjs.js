import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import globals from 'globals';

import base from './base.js';

// eslint-config-next ≥16 ships native flat config — imported directly,
// no FlatCompat bridge. Next's configs come first so base (which ends
// with eslint-config-prettier) keeps the last word on stylistic rules.
export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
