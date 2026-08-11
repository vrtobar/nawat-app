import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

// Shared flat config — extended by eslint/nestjs.js and eslint/nextjs.js.
// Runtime-specific globals (node vs browser) are added by those configs,
// not here, since this file doesn't know which app is consuming it.
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/.turbo/**', '**/generated/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // Type-aware linting without listing every tsconfig by hand —
        // resolves the nearest tsconfig.json per linted file.
        projectService: true,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Plain JS (config files like eslint.config.mjs, postcss.config.mjs)
  // sits outside any tsconfig — turn off type-aware analysis for it or
  // the project service errors on every such file.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  // Must stay last — turns off stylistic rules that fight Prettier.
  prettier,
);
