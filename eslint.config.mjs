import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

const browserGlobals = { window: 'readonly', document: 'readonly', crypto: 'readonly', btoa: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly', HTMLElement: 'readonly', Event: 'readonly' };

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: '@typescript-eslint/parser', extraFileExtensions: ['.vue'] }
    }
  },
  {
    languageOptions: { globals: browserGlobals },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'vue/multi-word-component-names': 'off'
    }
  },
  { ignores: ['dist/', 'node_modules/'] }
];
