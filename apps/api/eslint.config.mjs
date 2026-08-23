import nestjs from '@nahuat/config/eslint/nestjs';

export default [
  ...nestjs,
  {
    // scripts/ sits outside tsconfig.json's `include: ["src"]`, so the type-aware
    // project service cannot resolve it and fails to parse the file at all.
    // Point it at the tools config, which is the one that covers these.
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.tools.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
