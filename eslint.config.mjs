// eslint.config.mjs
// Solo contiene reglas que requieren type information (type-aware).
// Las reglas estructurales las maneja oxlint con velocidad Rust.
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    // Ignora archivos generados, configuraciones y JS compilado
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/*.js',
      '**/*.d.ts',
      'eslint.config.mjs',
    ],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // ── Reglas que REQUIEREN type information ──────────────────────────────
      // Detecta promesas pasadas a callbacks sin await: .forEach(async () => {})
      '@typescript-eslint/no-misused-promises': 'error',

      // async sin await es casi siempre un error de lógica
      '@typescript-eslint/require-await': 'error',

      // Tipos de retorno explícitos en funciones públicas de módulos
      '@typescript-eslint/explicit-module-boundary-types': [
        'warn',
        { allowArgumentsExplicitlyTypedAsAny: true },
      ],

      // ── Deshabilitadas: oxlint ya las cubre (evita duplicación y lentitud) ──
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-vars': 'off',

      // ── Relajadas por compatibilidad con código existente del sprint 1 ─────
      // La deuda técnica (db: any, broker: any) se corregirá progresivamente
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
