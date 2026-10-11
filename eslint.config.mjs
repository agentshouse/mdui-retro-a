import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
// Donor recommended TS/accessibility rules, with ESLint 9 for its a11y peer range.
// Unlike the donor's only-warn plugin, failures are blocking here.
export default [
  {ignores:['node_modules/**','dist/**','scripts/**','public/**']},
  {files:['src/**/*.{ts,tsx}','tests/**/*.{ts,tsx}'],languageOptions:{parser:tsParser,ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node,...globals.vitest},parserOptions:{ecmaFeatures:{jsx:true}}},plugins:{'@typescript-eslint':tsPlugin,'jsx-a11y':jsxA11y},rules:{...js.configs.recommended.rules,...tsPlugin.configs.recommended.rules,...jsxA11y.configs.recommended.rules,'no-undef':'off','no-unused-vars':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'jsx-a11y/no-autofocus':'off'}},
];
