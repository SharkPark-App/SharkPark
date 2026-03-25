import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import ts from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      "dist/**",
      "build/**",
      "node_modules/**",
      "babel.config.js",
      "metro.config.js",
      "jest.config.js",
      ".prettierrc.js",
      "android/**",
      "ios/**"
    ]
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      ...js.configs.recommended.rules,
      ...ts.configs.recommended.rules,
      "@typescript-eslint/no-unused-expressions": "off",
      "no-undef": "off",
      "no-restricted-imports": ["error", {
        paths: [{
          name: "react-native",
          importNames: ["Text", "TextInput"],
          message: "Import Text from '@/components/CustomText' and TextInput from '@/components/CustomTextInput' instead."
        }]
      }]
    }
  },
  {
    files: ["**/CustomText.tsx", "**/CustomTextInput.tsx"],
    rules: {
      "no-restricted-imports": "off"
    }
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx,js,jsx}", "**/*.test.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      },
      globals: {
        test: "readonly",
        expect: "readonly",
        describe: "readonly",
        beforeEach: "readonly",
        jest: "readonly"
      }
    },
    rules: {}
  }
];
